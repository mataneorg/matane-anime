import { describe, expect, it } from 'vitest';
import { RepoError } from './errors';
import { fingerprint, generateKeyPair, parsePrivateKey, parsePublicKey, publicKeyOf } from './keys';

describe('keys', () => {
  it('generates a PKCS8 PEM and a raw hex public key that round trips', () => {
    const { privateKeyPem, publicKey } = generateKeyPair();
    expect(privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(publicKey).toMatch(/^ed25519:[0-9a-f]{64}$/);
    expect(publicKeyOf(privateKeyPem)).toBe(publicKey);
    expect(parsePublicKey(publicKey)).toBe(publicKey);
  });

  it('generates distinct keys', () => {
    expect(generateKeyPair().publicKey).not.toBe(generateKeyPair().publicKey);
  });

  it.each([
    '',
    'ed25519:',
    'ed25519:abc',
    `ed25519:${'a'.repeat(63)}`,
    `ed25519:${'a'.repeat(65)}`,
    `ed25519:${'A'.repeat(64)}`,
    `ed25519:${'g'.repeat(64)}`,
    ` ed25519:${'a'.repeat(64)}`,
    `ed25519:${'a'.repeat(64)}\n`,
    `rsa:${'a'.repeat(64)}`,
    'a'.repeat(64),
  ])('rejects the malformed public key %j', (text) => {
    expect(() => parsePublicKey(text)).toThrow(RepoError);
    try {
      parsePublicKey(text);
    } catch (error) {
      expect((error as RepoError).code).toBe('bad_key');
    }
  });

  it('rejects non-string input without a raw TypeError', () => {
    expect(() => parsePublicKey(undefined as unknown as string)).toThrow(RepoError);
  });

  it('shortens a key to first and last four characters', () => {
    expect(fingerprint(`ed25519:7f3a${'0'.repeat(56)}c91e`)).toBe('ed25519:7f3a…c91e');
    expect(() => fingerprint('nope')).toThrow(RepoError);
  });

  it('rejects private keys that are garbage or not Ed25519', () => {
    expect(() => parsePrivateKey('not a pem')).toThrow(RepoError);
    expect(() => publicKeyOf('')).toThrow(RepoError);
  });
});
