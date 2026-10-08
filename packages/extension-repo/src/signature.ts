import { sign, verify } from 'node:crypto';
import { z } from 'zod';
import { RepoError } from './errors';
import { isPublicKey, parsePrivateKey, publicKeyObject, publicKeyOf, type PublicKey } from './keys';

const MAX_SIGNATURE_FILE_BYTES = 4096;
const SIGNATURE_LENGTH = 64;

export interface SignatureFile {
  alg: 'ed25519';
  /** The key the repository announces; trust is decided by the user, not by this value. */
  key: PublicKey;
  /** Base64 of the raw 64-byte signature over the exact bytes of `index.json`. */
  sig: string;
}

const signatureFileSchema = z.object({
  alg: z.literal('ed25519'),
  key: z.string().refine(isPublicKey, 'must be ed25519:<64 hex>'),
  sig: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, 'must be base64'),
});

/** Signs the exact bytes of `index.json` (no canonicalisation) and returns the text of `index.json.sig`. */
export function signIndex(indexBytes: Uint8Array, privateKeyPem: string): string {
  const key = parsePrivateKey(privateKeyPem);
  const signature = sign(null, indexBytes, key);
  const file: SignatureFile = {
    alg: 'ed25519',
    key: publicKeyOf(privateKeyPem),
    sig: signature.toString('base64'),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseSignatureFile(bytes: Uint8Array | string): SignatureFile {
  const raw = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;
  if (raw.length > MAX_SIGNATURE_FILE_BYTES) {
    throw new RepoError('bad_signature_file', 'index.json.sig is too large.');
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    throw new RepoError('bad_signature_file', 'index.json.sig is not valid UTF-8 JSON.');
  }
  const result = signatureFileSchema.safeParse(json);
  if (!result.success) {
    throw new RepoError('bad_signature_file', 'index.json.sig must be {"alg":"ed25519","key":"ed25519:…","sig":"…"}.');
  }
  if (Buffer.from(result.data.sig, 'base64').length !== SIGNATURE_LENGTH) {
    throw new RepoError('bad_signature_file', 'index.json.sig holds a signature of the wrong length.');
  }
  return result.data;
}

/** Never throws for a signature that does not verify: `valid` is false. `key` is the announced key. */
export function verifyIndexSignature(
  indexBytes: Uint8Array,
  signatureFile: SignatureFile,
): { valid: boolean; key: PublicKey } {
  try {
    const valid = verify(
      null,
      indexBytes,
      publicKeyObject(signatureFile.key),
      Buffer.from(signatureFile.sig, 'base64'),
    );
    return { valid, key: signatureFile.key };
  } catch {
    return { valid: false, key: signatureFile.key };
  }
}

export type RepoTrust = 'unsigned' | 'invalid' | 'unverified' | 'trusted' | 'key-changed';

export interface RepoClassification {
  status: RepoTrust;
  /** The key announced by a parseable signature file, else null. */
  announcedKey: PublicKey | null;
}

/**
 * - no signature file: `unsigned`
 * - unreadable or non-verifying signature: `invalid`
 * - valid, no trusted key yet: `unverified`
 * - valid and equal to the trusted key: `trusted`
 * - valid with another key than the trusted one: `key-changed` (the app rejects it)
 */
export function classifyRepo(input: {
  indexBytes: Uint8Array;
  sigBytes: Uint8Array | string | null;
  trustedKey: PublicKey | null;
}): RepoClassification {
  if (input.sigBytes === null) return { status: 'unsigned', announcedKey: null };
  let file: SignatureFile;
  try {
    file = parseSignatureFile(input.sigBytes);
  } catch {
    return { status: 'invalid', announcedKey: null };
  }
  const { valid, key } = verifyIndexSignature(input.indexBytes, file);
  if (!valid) return { status: 'invalid', announcedKey: key };
  if (input.trustedKey === null) return { status: 'unverified', announcedKey: key };
  return { status: key === input.trustedKey ? 'trusted' : 'key-changed', announcedKey: key };
}
