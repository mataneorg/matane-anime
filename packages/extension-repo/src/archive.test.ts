import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildArchive, readArchive, sha256Hex } from './archive';
import { RepoError, type RepoErrorCode } from './errors';
import { MAX_BUNDLE_BYTES, MAX_ICON_BYTES } from './index-file';
import { fakeIcon, manifestFor, rawZip, validEntries, type RawEntry } from './fixtures';

function codeOf(fn: () => unknown): RepoErrorCode | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof RepoError) return error.code;
    throw error;
  }
  return undefined;
}

/** The valid entries with one replaced or extra entry. */
function zipWith(extra: RawEntry[], replace?: string): Uint8Array {
  const base = validEntries().filter((entry) => entry.name !== replace);
  return rawZip([...base, ...extra]);
}

describe('buildArchive / readArchive', () => {
  const manifest = manifestFor('demo');
  const code = 'globalThis.hello = "world";';
  const icon = fakeIcon(7, 300);

  it('round trips manifest, code and icon', () => {
    const pkg = readArchive(buildArchive({ manifest, code, icon }));
    expect(pkg.manifest).toEqual(manifest);
    expect(new TextDecoder().decode(pkg.code)).toBe(code);
    expect(Array.from(pkg.icon)).toEqual(Array.from(icon));
  });

  it('accepts code as bytes', () => {
    const pkg = readArchive(buildArchive({ manifest, code: new TextEncoder().encode(code), icon }));
    expect(new TextDecoder().decode(pkg.code)).toBe(code);
  });

  it('contains exactly the three files in a stable order', () => {
    const files = unzipSync(buildArchive({ manifest, code, icon }));
    expect(Object.keys(files)).toEqual(['manifest.json', 'index.js', 'icon.png']);
  });

  it('is deterministic: same input, same bytes and hash', () => {
    const a = buildArchive({ manifest, code, icon });
    const b = buildArchive({ manifest: structuredClone(manifest), code, icon: Uint8Array.from(icon) });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    expect(sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the hash when the code changes', () => {
    expect(sha256Hex(buildArchive({ manifest, code: `${code} `, icon }))).not.toBe(
      sha256Hex(buildArchive({ manifest, code, icon })),
    );
  });

  it('refuses to build an oversized bundle or icon, an empty icon, or an invalid manifest', () => {
    expect(codeOf(() => buildArchive({ manifest, code: 'x'.repeat(MAX_BUNDLE_BYTES + 1), icon }))).toBe('too_large');
    expect(codeOf(() => buildArchive({ manifest, code, icon: new Uint8Array(MAX_ICON_BYTES + 1) }))).toBe('too_large');
    expect(codeOf(() => buildArchive({ manifest, code, icon: new Uint8Array(0) }))).toBe('too_large');
    expect(codeOf(() => buildArchive({ manifest: { ...manifest, id: 'Bad Id' }, code, icon }))).toBe('bad_archive');
    expect(codeOf(() => buildArchive({ manifest: { ...manifest, apiVersion: 2 }, code, icon }))).toBe(
      'incompatible_api',
    );
  });

  it('accepts a bundle exactly at the limit', () => {
    const pkg = readArchive(buildArchive({ manifest, code: 'x'.repeat(MAX_BUNDLE_BYTES), icon }));
    expect(pkg.code).toHaveLength(MAX_BUNDLE_BYTES);
  });

  it('accepts stored (uncompressed) entries from other zip writers', () => {
    const pkg = readArchive(rawZip(validEntries().map((entry) => ({ ...entry, method: 0 }))));
    expect(pkg.manifest.id).toBe('demo');
  });

  it('accepts entries in any order', () => {
    expect(readArchive(rawZip(validEntries().reverse())).manifest.id).toBe('demo');
  });
});

describe('readArchive rejects malicious or broken archives', () => {
  it('rejects data that is not a zip', () => {
    expect(codeOf(() => readArchive(new TextEncoder().encode('not a zip at all, just text')))).toBe('bad_archive');
    expect(codeOf(() => readArchive(new Uint8Array(0)))).toBe('bad_archive');
    expect(codeOf(() => readArchive(new Uint8Array(21)))).toBe('bad_archive');
  });

  it('rejects a truncated archive', () => {
    const zip = buildArchive({ manifest: manifestFor('demo'), code: 'x', icon: fakeIcon() });
    expect(codeOf(() => readArchive(zip.subarray(0, zip.length - 30)))).toBe('bad_archive');
    expect(codeOf(() => readArchive(zip.subarray(0, 40)))).toBe('bad_archive');
  });

  it('rejects an extra entry', () => {
    expect(codeOf(() => readArchive(zipWith([{ name: 'extra.txt', data: 'hi' }])))).toBe('bad_archive');
  });

  it.each([
    '../evil',
    '../../etc/passwd',
    '..',
    '/index.js',
    '/etc/passwd',
    'C:\\windows\\evil.dll',
    '..\\evil',
    'dir/index.js',
    'dir/',
    'nested/deep/manifest.json',
    './index.js',
    'index.js\0.png',
    'icon.png/',
  ])('rejects the path %j', (name) => {
    expect(codeOf(() => readArchive(zipWith([{ name, data: 'x' }])))).toBe('bad_archive');
  });

  it('rejects a path hiding behind a valid-looking prefix even when the valid files are present', () => {
    const zip = rawZip([...validEntries(), { name: 'sub/../index.js', data: 'evil' }]);
    expect(codeOf(() => readArchive(zip))).toBe('bad_archive');
  });

  it('rejects duplicate names', () => {
    expect(codeOf(() => readArchive(zipWith([{ name: 'index.js', data: 'second' }])))).toBe('bad_archive');
  });

  it('rejects missing files', () => {
    for (const name of ['manifest.json', 'index.js', 'icon.png']) {
      expect(codeOf(() => readArchive(rawZip(validEntries().filter((e) => e.name !== name))))).toBe('bad_archive');
    }
  });

  it('rejects encrypted entries (traditional, strong, and header-masked)', () => {
    for (const flags of [0x1, 0x40, 0x2000]) {
      expect(codeOf(() => readArchive(zipWith([{ name: 'index.js', data: 'x', flags }], 'index.js')))).toBe(
        'bad_archive',
      );
    }
  });

  it('rejects unsupported compression methods', () => {
    for (const method of [1, 6, 9, 12, 14, 93, 99]) {
      expect(codeOf(() => readArchive(zipWith([{ name: 'index.js', data: 'x', method }], 'index.js')))).toBe(
        'bad_archive',
      );
    }
  });

  it('rejects a declared uncompressed size over the limit before inflating anything', () => {
    // A tiny real body but a central directory announcing 1 GB.
    const bomb = zipWith([{ name: 'index.js', data: 'x', declaredSize: 1024 * 1024 * 1024 }], 'index.js');
    expect(codeOf(() => readArchive(bomb))).toBe('too_large');
    const iconBomb = zipWith([{ name: 'icon.png', data: 'x', declaredSize: MAX_ICON_BYTES + 1 }], 'icon.png');
    expect(codeOf(() => readArchive(iconBomb))).toBe('too_large');
    const manifestBomb = zipWith([{ name: 'manifest.json', data: '{}', declaredSize: 10_000_000 }], 'manifest.json');
    expect(codeOf(() => readArchive(manifestBomb))).toBe('too_large');
  });

  it('rejects an honest oversized bundle or icon', () => {
    const big = zipWith([{ name: 'index.js', data: new Uint8Array(MAX_BUNDLE_BYTES + 1) }], 'index.js');
    expect(codeOf(() => readArchive(big))).toBe('too_large');
    const bigIcon = zipWith([{ name: 'icon.png', data: new Uint8Array(MAX_ICON_BYTES + 1) }], 'icon.png');
    expect(codeOf(() => readArchive(bigIcon))).toBe('too_large');
  });

  it('rejects a compression bomb that lies about its size (declared small, inflates huge)', () => {
    const zeros = new Uint8Array(50 * 1024 * 1024);
    const bomb = zipWith([{ name: 'index.js', data: zeros, declaredSize: 10 }], 'index.js');
    expect(bomb.length).toBeLessThan(200 * 1024);
    expect(codeOf(() => readArchive(bomb))).toBe('bad_archive');
  });

  it('rejects an entry whose declared size differs from the real one', () => {
    const lying = zipWith([{ name: 'index.js', data: 'abcdef', declaredSize: 100 }], 'index.js');
    expect(codeOf(() => readArchive(lying))).toBe('bad_archive');
  });

  it('rejects an archive file over the archive limit, and honours custom limits', () => {
    const zip = buildArchive({ manifest: manifestFor('demo'), code: 'x'.repeat(1000), icon: fakeIcon(1, 600) });
    expect(codeOf(() => readArchive(zip, { maxArchiveBytes: zip.length - 1 }))).toBe('too_large');
    expect(codeOf(() => readArchive(zip, { maxBundleBytes: 999 }))).toBe('too_large');
    expect(codeOf(() => readArchive(zip, { maxIconBytes: 599 }))).toBe('too_large');
    expect(readArchive(zip, { maxBundleBytes: 1000, maxIconBytes: 600 }).code).toHaveLength(1000);
  });

  it('rejects Zip64 markers and too many entries', () => {
    const zip = Uint8Array.from(rawZip(validEntries()));
    const view = new DataView(zip.buffer);
    view.setUint16(zip.length - 22 + 10, 0xffff, true);
    expect(codeOf(() => readArchive(zip))).toBe('bad_archive');
    const many = Array.from({ length: 17 }, (_, i) => ({ name: `f${i}`, data: 'x' }));
    expect(codeOf(() => readArchive(rawZip([...validEntries(), ...many])))).toBe('bad_archive');
  });

  it('rejects a corrupt central directory offset', () => {
    const zip = Uint8Array.from(rawZip(validEntries()));
    new DataView(zip.buffer).setUint32(zip.length - 22 + 16, zip.length + 1000, true);
    expect(codeOf(() => readArchive(zip))).toBe('bad_archive');
  });

  it('rejects a corrupt deflate stream', () => {
    const zip = Uint8Array.from(rawZip(validEntries().map((e) => ({ ...e, method: 8 }))));
    // Flip bytes inside the first (manifest) body.
    for (let i = 40; i < 60; i++) zip[i] = 0xff;
    expect(codeOf(() => readArchive(zip))).toBe('bad_archive');
  });

  describe('manifest', () => {
    const withManifest = (data: string | Uint8Array) =>
      rawZip(validEntries().map((e) => (e.name === 'manifest.json' ? { ...e, data } : e)));

    it('rejects invalid JSON, invalid UTF-8 and schema violations', () => {
      expect(codeOf(() => readArchive(withManifest('{nope')))).toBe('bad_archive');
      expect(codeOf(() => readArchive(withManifest(Uint8Array.of(0xff, 0xfe))))).toBe('bad_archive');
      expect(codeOf(() => readArchive(withManifest('[]')))).toBe('bad_archive');
      expect(codeOf(() => readArchive(withManifest(JSON.stringify({ ...manifestFor('demo'), id: 'A' }))))).toBe(
        'bad_archive',
      );
      expect(codeOf(() => readArchive(withManifest(JSON.stringify({ ...manifestFor('demo'), type: 'manga' }))))).toBe(
        'bad_archive',
      );
      expect(codeOf(() => readArchive(withManifest(JSON.stringify({ ...manifestFor('demo'), sources: [] }))))).toBe(
        'bad_archive',
      );
    });

    it('says "needs a newer app" for apiVersion above the supported one', () => {
      try {
        readArchive(withManifest(JSON.stringify({ ...manifestFor('demo'), apiVersion: 2 })));
        expect.unreachable();
      } catch (error) {
        expect((error as RepoError).code).toBe('incompatible_api');
        expect((error as RepoError).message).toMatch(/Update the app/);
      }
    });

    it('accepts a lower apiVersion', () => {
      expect(readArchive(withManifest(JSON.stringify(manifestFor('demo')))).manifest.apiVersion).toBe(1);
    });

    it('does not look inside the bundle (the CLI forbids require/import)', () => {
      const zip = rawZip(
        validEntries().map((e) => (e.name === 'index.js' ? { ...e, data: 'require("fs"); import("x")' } : e)),
      );
      expect(readArchive(zip).manifest.id).toBe('demo');
    });
  });
});
