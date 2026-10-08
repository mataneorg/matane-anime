import { describe, expect, it } from 'vitest';
import { RepoError } from './errors';
import { generateKeyPair } from './keys';
import { classifyRepo, parseSignatureFile, signIndex, verifyIndexSignature } from './signature';

const index = new TextEncoder().encode('{"format":1,"name":"x"}\n');
const alice = generateKeyPair();
const bob = generateKeyPair();

describe('signIndex / verifyIndexSignature', () => {
  it('writes the documented JSON shape and verifies', () => {
    const text = signIndex(index, alice.privateKeyPem);
    const file = parseSignatureFile(text);
    expect(file.alg).toBe('ed25519');
    expect(file.key).toBe(alice.publicKey);
    expect(Buffer.from(file.sig, 'base64')).toHaveLength(64);
    expect(verifyIndexSignature(index, file)).toEqual({ valid: true, key: alice.publicKey });
  });

  it('is deterministic (Ed25519) and accepts bytes or text', () => {
    expect(signIndex(index, alice.privateKeyPem)).toBe(signIndex(index, alice.privateKeyPem));
    const text = signIndex(index, alice.privateKeyPem);
    expect(parseSignatureFile(Buffer.from(text))).toEqual(parseSignatureFile(text));
  });

  it('fails when a single byte of index.json changes', () => {
    const file = parseSignatureFile(signIndex(index, alice.privateKeyPem));
    for (let i = 0; i < index.length; i++) {
      const tampered = Uint8Array.from(index);
      tampered[i] = tampered[i]! ^ 1;
      expect(verifyIndexSignature(tampered, file).valid).toBe(false);
    }
    expect(verifyIndexSignature(new TextEncoder().encode('{"format":1,"name":"x"} \n'), file).valid).toBe(false);
  });

  it('fails for a signature made with another key but announcing this one', () => {
    const forged = { ...parseSignatureFile(signIndex(index, bob.privateKeyPem)), key: alice.publicKey };
    expect(verifyIndexSignature(index, forged)).toEqual({ valid: false, key: alice.publicKey });
  });

  it('returns false instead of throwing for a corrupt signature or an invalid key point', () => {
    const file = parseSignatureFile(signIndex(index, alice.privateKeyPem));
    expect(verifyIndexSignature(index, { ...file, sig: Buffer.alloc(64).toString('base64') }).valid).toBe(false);
    expect(verifyIndexSignature(index, { ...file, sig: 'AAAA' }).valid).toBe(false);
    expect(verifyIndexSignature(index, { ...file, key: `ed25519:${'f'.repeat(64)}` }).valid).toBe(false);
  });

  it('rejects a bad private key with bad_key', () => {
    expect(() => signIndex(index, 'nope')).toThrow(RepoError);
  });
});

describe('parseSignatureFile', () => {
  const good = JSON.parse(signIndex(index, alice.privateKeyPem)) as Record<string, string>;

  it.each<[string, unknown]>([
    ['not JSON', 'nope'],
    ['an array', []],
    ['wrong alg', { ...good, alg: 'rsa' }],
    ['bad key', { ...good, key: 'ed25519:xyz' }],
    ['missing sig', { alg: 'ed25519', key: good.key }],
    ['non-base64 sig', { ...good, sig: '!!!!' }],
    ['short sig', { ...good, sig: 'AAAA' }],
  ])('rejects %s', (_label, value) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    try {
      parseSignatureFile(text);
      expect.unreachable();
    } catch (error) {
      expect((error as RepoError).code).toBe('bad_signature_file');
    }
  });

  it('rejects an oversized file and invalid UTF-8', () => {
    expect(() => parseSignatureFile(new Uint8Array(5000))).toThrow(RepoError);
    expect(() => parseSignatureFile(Uint8Array.of(0xff, 0xfe))).toThrow(RepoError);
  });
});

describe('classifyRepo', () => {
  const sig = signIndex(index, alice.privateKeyPem);

  it('unsigned: no signature file', () => {
    expect(classifyRepo({ indexBytes: index, sigBytes: null, trustedKey: null })).toEqual({
      status: 'unsigned',
      announcedKey: null,
    });
    expect(classifyRepo({ indexBytes: index, sigBytes: null, trustedKey: alice.publicKey }).status).toBe('unsigned');
  });

  it('invalid: tampered index, garbage signature file, forged key', () => {
    const tampered = Uint8Array.from(index);
    tampered[3] = tampered[3]! ^ 1;
    expect(classifyRepo({ indexBytes: tampered, sigBytes: sig, trustedKey: null })).toEqual({
      status: 'invalid',
      announcedKey: alice.publicKey,
    });
    expect(classifyRepo({ indexBytes: index, sigBytes: 'garbage', trustedKey: alice.publicKey })).toEqual({
      status: 'invalid',
      announcedKey: null,
    });
    const forged = JSON.stringify({ ...JSON.parse(signIndex(index, bob.privateKeyPem)), key: alice.publicKey });
    expect(classifyRepo({ indexBytes: index, sigBytes: forged, trustedKey: alice.publicKey }).status).toBe('invalid');
  });

  it('unverified: valid signature, no trusted key', () => {
    expect(classifyRepo({ indexBytes: index, sigBytes: sig, trustedKey: null })).toEqual({
      status: 'unverified',
      announcedKey: alice.publicKey,
    });
  });

  it('trusted: valid and equal to the trusted key', () => {
    expect(classifyRepo({ indexBytes: index, sigBytes: sig, trustedKey: alice.publicKey })).toEqual({
      status: 'trusted',
      announcedKey: alice.publicKey,
    });
  });

  it('key-changed: valid with another key than the trusted one', () => {
    expect(classifyRepo({ indexBytes: index, sigBytes: sig, trustedKey: bob.publicKey })).toEqual({
      status: 'key-changed',
      announcedKey: alice.publicKey,
    });
  });
});
