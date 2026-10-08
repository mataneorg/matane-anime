import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { RepoError } from './errors';

const PUBLIC_KEY_PATTERN = /^ed25519:[0-9a-f]{64}$/;
/** DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32 raw key bytes follow. */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** `ed25519:<64 lower-case hex chars>`: the raw 32-byte public key. */
export type PublicKey = string;

export interface RepoKeyPair {
  /** PKCS8 PEM. Keep it secret; it signs the repository index. */
  privateKeyPem: string;
  publicKey: PublicKey;
}

function rawPublicKey(key: KeyObject): PublicKey {
  const der = key.export({ type: 'spki', format: 'der' });
  return `ed25519:${der.subarray(der.length - 32).toString('hex')}`;
}

export function generateKeyPair(): RepoKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: rawPublicKey(publicKey),
  };
}

/** Throws `bad_key` for anything that is not an Ed25519 private key in PEM. */
export function parsePrivateKey(privateKeyPem: string): KeyObject {
  try {
    const key = createPrivateKey(privateKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('not ed25519');
    return key;
  } catch {
    throw new RepoError('bad_key', 'The private key is not an Ed25519 key in PEM format.');
  }
}

export function publicKeyOf(privateKeyPem: string): PublicKey {
  return rawPublicKey(createPublicKey(parsePrivateKey(privateKeyPem)));
}

/** Strict: exactly `ed25519:` plus 64 lower-case hex chars, nothing else (no spaces, no upper case). */
export function parsePublicKey(text: string): PublicKey {
  if (typeof text !== 'string' || !PUBLIC_KEY_PATTERN.test(text)) {
    throw new RepoError('bad_key', 'A public key looks like "ed25519:" followed by 64 lower-case hex characters.');
  }
  return text;
}

export function isPublicKey(text: unknown): text is PublicKey {
  return typeof text === 'string' && PUBLIC_KEY_PATTERN.test(text);
}

/** Short display form, e.g. `ed25519:7f3a…c91e` (first and last 4 hex chars). */
export function fingerprint(publicKey: PublicKey): string {
  const hex = parsePublicKey(publicKey).slice('ed25519:'.length);
  return `ed25519:${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

/** @internal Node key object of a validated public key; throws if the bytes are not a valid point. */
export function publicKeyObject(publicKey: PublicKey): KeyObject {
  const raw = Buffer.from(parsePublicKey(publicKey).slice('ed25519:'.length), 'hex');
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}
