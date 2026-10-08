import { describe, expect, it } from 'vitest';
import { buildArchive, readArchive, sha256Hex } from './archive';
import { buildRepoFiles, verifyRepoFiles, type RepoProblem } from './build';
import { RepoError } from './errors';
import { fakeIcon, manifestFor } from './fixtures';
import { parseIndex } from './index-file';
import { generateKeyPair } from './keys';
import { classifyRepo, signIndex } from './signature';

const key = generateKeyPair();
const other = generateKeyPair();
const generatedAt = '2026-05-01T10:00:00.000Z';

function packages() {
  return [
    { manifest: manifestFor('zeta', { version: '2.0.0' }), code: 'globalThis.z = 1;', icon: fakeIcon(1, 100) },
    {
      manifest: manifestFor('alpha', { nsfw: true, sources: [{ key: 'a', lang: 'ja', name: 'Alpha' }] }),
      code: 'globalThis.a = 1;',
      icon: fakeIcon(2, 120),
      minAppVersion: '0.2.0',
    },
  ];
}

function build(extra: Partial<Parameters<typeof buildRepoFiles>[0]> = {}) {
  return buildRepoFiles({
    name: 'Test repo',
    serial: 4,
    generatedAt,
    packages: packages(),
    privateKeyPem: key.privateKeyPem,
    ...extra,
  });
}

const codes = (problems: RepoProblem[]) => problems.map((p) => p.code);

function mutated(files: Map<string, Uint8Array>, name: string, change: (bytes: Uint8Array) => Uint8Array) {
  const copy = new Map(files);
  copy.set(name, change(Uint8Array.from(files.get(name)!)));
  return copy;
}

const flip = (bytes: Uint8Array, at = 5) => {
  bytes[at] = bytes[at]! ^ 1;
  return bytes;
};

describe('buildRepoFiles', () => {
  it('produces the static repo layout, sorted', () => {
    expect([...build().keys()]).toEqual([
      'alpha-1.0.0.zip',
      'alpha.png',
      'index.json',
      'index.json.sig',
      'zeta-2.0.0.zip',
      'zeta.png',
    ]);
  });

  it('omits the signature without a key', () => {
    const files = build({ privateKeyPem: undefined });
    expect(files.has('index.json.sig')).toBe(false);
    expect(files.has('index.json')).toBe(true);
  });

  it('writes a consistent index with langs and sources derived from the manifests', () => {
    const files = build();
    const index = parseIndex(files.get('index.json')!);
    expect(index).toMatchObject({ format: 1, name: 'Test repo', serial: 4, generatedAt });
    expect(index.extensions.map((e) => e.id)).toEqual(['alpha', 'zeta']);
    const [alpha, zeta] = index.extensions;
    expect(alpha).toMatchObject({
      version: '1.0.0',
      nsfw: true,
      minAppVersion: '0.2.0',
      langs: ['ja'],
      sources: [{ key: 'a', lang: 'ja', name: 'Alpha' }],
      archive: 'alpha-1.0.0.zip',
      icon: 'alpha.png',
      size: files.get('alpha-1.0.0.zip')!.length,
      iconSize: 120,
    });
    expect(zeta?.langs).toEqual(['en', 'id']);
    expect(zeta?.minAppVersion).toBeUndefined();
    expect(readArchive(files.get('zeta-2.0.0.zip')!).manifest.version).toBe('2.0.0');
  });

  it('is deterministic', () => {
    const a = build();
    const b = build();
    for (const [name, bytes] of a) expect(Buffer.from(bytes).equals(Buffer.from(b.get(name)!))).toBe(true);
  });

  it('signs the exact bytes of index.json', () => {
    const files = build();
    expect(
      classifyRepo({
        indexBytes: files.get('index.json')!,
        sigBytes: files.get('index.json.sig')!,
        trustedKey: key.publicKey,
      }).status,
    ).toBe('trusted');
  });

  it('prefixes references with archiveBase (with or without a trailing slash)', () => {
    for (const archiveBase of ['https://cdn.example/r', 'https://cdn.example/r/']) {
      const index = parseIndex(build({ archiveBase }).get('index.json')!);
      expect(index.extensions[0]?.archive).toBe('https://cdn.example/r/alpha-1.0.0.zip');
      expect(index.extensions[0]?.icon).toBe('https://cdn.example/r/alpha.png');
    }
  });

  it('refuses duplicate ids, bad serials and invalid manifests', () => {
    const [first] = packages();
    expect(() => build({ packages: [first!, first!] })).toThrow(RepoError);
    expect(() => build({ serial: -1 })).toThrow(RepoError);
    expect(() => build({ packages: [{ ...first!, manifest: { ...first!.manifest, id: 'Bad' } }] })).toThrow(RepoError);
    expect(() => build({ packages: [{ ...first!, minAppVersion: 'soon' }] })).toThrow(RepoError);
  });

  it('builds an empty repository', () => {
    const files = build({ packages: [] });
    expect([...files.keys()]).toEqual(['index.json', 'index.json.sig']);
    expect(verifyRepoFiles(files, { trustedKey: key.publicKey })).toEqual([]);
  });
});

describe('verifyRepoFiles', () => {
  it('is clean for a signed repo, with or without a trusted key', () => {
    const files = build();
    expect(verifyRepoFiles(files)).toEqual([]);
    expect(verifyRepoFiles(files, { trustedKey: key.publicKey })).toEqual([]);
  });

  it('is clean for an absolute-URL repo (files found by their last path segment)', () => {
    expect(verifyRepoFiles(build({ archiveBase: 'https://cdn.example/deep/r/' }))).toEqual([]);
  });

  it('is clean for an unsigned repo unless a trusted key is expected', () => {
    const files = build({ privateKeyPem: undefined });
    expect(verifyRepoFiles(files)).toEqual([]);
    expect(codes(verifyRepoFiles(files, { trustedKey: key.publicKey }))).toEqual(['unsigned']);
  });

  it('reports a changed archive byte', () => {
    const problems = verifyRepoFiles(mutated(build(), 'zeta-2.0.0.zip', (b) => flip(b, 20)));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ code: 'hash_mismatch', file: 'zeta-2.0.0.zip', id: 'zeta' });
  });

  it('reports a changed archive length', () => {
    const files = mutated(build(), 'zeta-2.0.0.zip', (b) => b.subarray(0, b.length - 1));
    expect(codes(verifyRepoFiles(files))).toEqual(['size_mismatch']);
  });

  it('reports a changed icon byte', () => {
    const problems = verifyRepoFiles(mutated(build(), 'alpha.png', (b) => flip(b, 0)));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ code: 'icon_mismatch', file: 'alpha.png', id: 'alpha' });
  });

  it('reports a changed index byte as an invalid signature', () => {
    const files = build();
    // Change a character inside the repo name: still valid JSON, but no longer what was signed.
    const text = Buffer.from(files.get('index.json')!).toString().replace('Test repo', 'Test rapo');
    const problems = verifyRepoFiles(new Map(files).set('index.json', Buffer.from(text)));
    expect(codes(problems)).toEqual(['invalid_signature']);
  });

  it('reports a swapped signature file from another key (valid signature, different key than the trusted one)', () => {
    const files = build();
    const swapped = new Map(files).set(
      'index.json.sig',
      Buffer.from(signIndex(files.get('index.json')!, other.privateKeyPem)),
    );
    expect(verifyRepoFiles(swapped)).toEqual([]);
    expect(codes(verifyRepoFiles(swapped, { trustedKey: key.publicKey }))).toEqual(['key_changed']);
  });

  it('reports a signature of the old index after the index changed hands (tampering with the signature)', () => {
    const files = build();
    const tampered = mutated(files, 'index.json.sig', (b) => {
      const file = JSON.parse(Buffer.from(b).toString()) as { sig: string };
      const sig = Buffer.from(file.sig, 'base64');
      sig[0] = sig[0]! ^ 1;
      return Buffer.from(JSON.stringify({ ...file, sig: sig.toString('base64') }));
    });
    expect(codes(verifyRepoFiles(tampered))).toEqual(['invalid_signature']);
    expect(codes(verifyRepoFiles(mutated(files, 'index.json.sig', () => Buffer.from('garbage'))))).toEqual([
      'invalid_signature',
    ]);
  });

  it('reports a size change in a re-signed index (the archive no longer matches its entry)', () => {
    const files = build();
    const index = JSON.parse(Buffer.from(files.get('index.json')!).toString()) as { extensions: { size: number }[] };
    index.extensions[0]!.size += 1;
    const indexBytes = Buffer.from(JSON.stringify(index, null, 2));
    const resigned = new Map(files)
      .set('index.json', indexBytes)
      .set('index.json.sig', Buffer.from(signIndex(indexBytes, key.privateKeyPem)));
    const problems = verifyRepoFiles(resigned, { trustedKey: key.publicKey });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ code: 'size_mismatch', id: 'alpha' });
  });

  it('reports an archive whose manifest differs from its entry, even with matching hash and size', () => {
    const files = build();
    const forged = buildArchive({
      manifest: manifestFor('alpha', {
        version: '9.9.9',
        nsfw: true,
        sources: [{ key: 'a', lang: 'ja', name: 'Alpha' }],
      }),
      code: 'evil',
      icon: fakeIcon(2, 120),
    });
    const index = JSON.parse(Buffer.from(files.get('index.json')!).toString()) as {
      extensions: { sha256: string; size: number }[];
    };
    index.extensions[0]!.sha256 = sha256Hex(forged);
    index.extensions[0]!.size = forged.length;
    const indexBytes = Buffer.from(JSON.stringify(index, null, 2));
    const resigned = new Map(files)
      .set('alpha-1.0.0.zip', forged)
      .set('index.json', indexBytes)
      .set('index.json.sig', Buffer.from(signIndex(indexBytes, key.privateKeyPem)));
    expect(verifyRepoFiles(resigned, { trustedKey: key.publicKey })).toMatchObject([
      { code: 'manifest_mismatch', id: 'alpha' },
    ]);
  });

  it('reports missing files', () => {
    const files = build();
    const noArchive = new Map(files);
    noArchive.delete('alpha-1.0.0.zip');
    expect(verifyRepoFiles(noArchive)).toMatchObject([{ code: 'missing_file', file: 'alpha-1.0.0.zip', id: 'alpha' }]);
    const noIcon = new Map(files);
    noIcon.delete('zeta.png');
    expect(verifyRepoFiles(noIcon)).toMatchObject([{ code: 'missing_file', file: 'zeta.png', id: 'zeta' }]);
    expect(verifyRepoFiles(new Map())).toMatchObject([{ code: 'missing_file', file: 'index.json' }]);
  });

  it('reports a broken index (and keeps the signature verdict)', () => {
    const indexBytes = Buffer.from('{"format":1}');
    const files = new Map<string, Uint8Array>([
      ['index.json', indexBytes],
      ['index.json.sig', Buffer.from(signIndex(indexBytes, key.privateKeyPem))],
    ]);
    expect(codes(verifyRepoFiles(files, { trustedKey: key.publicKey }))).toEqual(['bad_index']);
    expect(codes(verifyRepoFiles(new Map([['index.json', Buffer.alloc(3 * 1024 * 1024)]])))).toEqual([
      'index_too_large',
    ]);
  });

  it('reports several problems at once', () => {
    const files = mutated(
      mutated(build(), 'zeta-2.0.0.zip', (b) => flip(b, 20)),
      'alpha.png',
      (b) => flip(b, 0),
    );
    expect(codes(verifyRepoFiles(files)).sort()).toEqual(['hash_mismatch', 'icon_mismatch']);
  });
});
