import { describe, expect, it } from 'vitest';
import { buildArchive, sha256Hex } from './archive';
import { RepoError, type RepoErrorCode } from './errors';
import { fakeIcon, manifestFor, rawZip, validEntries } from './fixtures';
import { MAX_ARCHIVE_BYTES, MAX_ICON_BYTES, type IndexEntry } from './index-file';
import { languagesOf, verifyPackage } from './verify';

const manifest = manifestFor('demo');
const icon = fakeIcon(3, 200);

function makeEntry(archive: Uint8Array, overrides: Partial<IndexEntry> = {}): IndexEntry {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    nsfw: manifest.nsfw,
    langs: ['en', 'id'],
    sources: manifest.sources,
    archive: 'demo-1.0.0.zip',
    sha256: sha256Hex(archive),
    size: archive.length,
    icon: 'demo.png',
    iconSha256: sha256Hex(icon),
    iconSize: icon.length,
    ...overrides,
  };
}

function codeOf(fn: () => unknown): RepoErrorCode | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof RepoError) return error.code;
    throw error;
  }
  return undefined;
}

const archive = buildArchive({ manifest, code: 'x', icon });

describe('verifyPackage', () => {
  it('returns the parsed package when everything matches', () => {
    const pkg = verifyPackage(makeEntry(archive), archive, icon);
    expect(pkg.manifest.id).toBe('demo');
    expect(new TextDecoder().decode(pkg.code)).toBe('x');
  });

  it('works without the icon bytes', () => {
    expect(verifyPackage(makeEntry(archive, { iconSha256: 'f'.repeat(64) }), archive, null).manifest.id).toBe('demo');
  });

  it('size_mismatch', () => {
    expect(codeOf(() => verifyPackage(makeEntry(archive, { size: archive.length + 1 }), archive, icon))).toBe(
      'size_mismatch',
    );
    expect(codeOf(() => verifyPackage(makeEntry(archive), archive.subarray(0, archive.length - 1), icon))).toBe(
      'size_mismatch',
    );
  });

  it('hash_mismatch (same length, one byte flipped)', () => {
    const flipped = Uint8Array.from(archive);
    flipped[10] = flipped[10]! ^ 1;
    expect(codeOf(() => verifyPackage(makeEntry(archive), flipped, icon))).toBe('hash_mismatch');
    expect(codeOf(() => verifyPackage(makeEntry(archive, { sha256: '0'.repeat(64) }), archive, icon))).toBe(
      'hash_mismatch',
    );
  });

  it('too_large', () => {
    expect(codeOf(() => verifyPackage(makeEntry(archive), new Uint8Array(MAX_ARCHIVE_BYTES + 1), icon))).toBe(
      'too_large',
    );
    expect(codeOf(() => verifyPackage(makeEntry(archive), archive, new Uint8Array(MAX_ICON_BYTES + 1)))).toBe(
      'too_large',
    );
  });

  it('bad_archive when the bytes match the entry but are not a valid archive', () => {
    const junk = new TextEncoder().encode('this is not a zip');
    expect(codeOf(() => verifyPackage(makeEntry(junk), junk, icon))).toBe('bad_archive');
    const extra = rawZip([...validEntries(manifest), { name: '../evil', data: 'x' }]);
    expect(codeOf(() => verifyPackage(makeEntry(extra), extra, icon))).toBe('bad_archive');
  });

  it('incompatible_api when the archive needs a newer app, even if the entry claims otherwise', () => {
    const newer = rawZip(validEntries({ ...manifest, apiVersion: 2 }));
    expect(codeOf(() => verifyPackage(makeEntry(newer), newer, icon))).toBe('incompatible_api');
    expect(codeOf(() => verifyPackage(makeEntry(newer, { apiVersion: 2 }), newer, icon))).toBe('incompatible_api');
  });

  describe('manifest_mismatch', () => {
    it.each<[string, Partial<IndexEntry>]>([
      ['id', { id: 'other' }],
      ['version', { version: '1.0.1' }],
      ['apiVersion', { apiVersion: 2 }],
      ['nsfw', { nsfw: true }],
      ['language list', { langs: ['en'] }],
      ['extra language', { langs: ['en', 'id', 'ja'] }],
      ['sources', { sources: [{ key: 'main', lang: 'en', name: 'Renamed' }] }],
    ])('the entry %s differs', (_label, overrides) => {
      expect(codeOf(() => verifyPackage(makeEntry(archive, overrides), archive, icon))).toBe('manifest_mismatch');
    });

    it('accepts langs in another order and with duplicates', () => {
      expect(verifyPackage(makeEntry(archive, { langs: ['id', 'en', 'en'] }), archive, icon).manifest.id).toBe('demo');
    });
  });

  it('icon_mismatch', () => {
    const other = fakeIcon(9, 200);
    expect(codeOf(() => verifyPackage(makeEntry(archive), archive, other))).toBe('icon_mismatch');
    expect(codeOf(() => verifyPackage(makeEntry(archive), archive, icon.subarray(1)))).toBe('icon_mismatch');
    expect(codeOf(() => verifyPackage(makeEntry(archive, { iconSize: 7 }), archive, icon))).toBe('icon_mismatch');
  });
});

describe('languagesOf', () => {
  it('de-duplicates in order of appearance', () => {
    expect(languagesOf([{ lang: 'en' }, { lang: 'id' }, { lang: 'en' }, { lang: 'multi' }])).toEqual([
      'en',
      'id',
      'multi',
    ]);
  });
});
