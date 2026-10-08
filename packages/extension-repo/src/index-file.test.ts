import { describe, expect, it } from 'vitest';
import { RepoError } from './errors';
import { MAX_INDEX_BYTES, parseIndex, resolveUrl, type RepoIndex } from './index-file';

const hash = 'a'.repeat(64);

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'demo',
    name: 'Demo',
    version: '1.2.3',
    apiVersion: 1,
    nsfw: false,
    langs: ['en'],
    sources: [{ key: 'main', lang: 'en', name: 'Main' }],
    archive: 'demo-1.2.3.zip',
    sha256: hash,
    size: 1000,
    icon: 'demo.png',
    iconSha256: hash,
    iconSize: 100,
    ...overrides,
  };
}

function index(overrides: Record<string, unknown> = {}, extensions: unknown[] = [entry()]) {
  return {
    format: 1,
    name: 'Test repo',
    serial: 3,
    generatedAt: '2026-05-01T10:00:00.000Z',
    extensions,
    ...overrides,
  };
}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof RepoError) return error.code;
    throw error;
  }
  return undefined;
}

describe('parseIndex', () => {
  it('accepts a valid index and keeps optional minAppVersion', () => {
    const parsed: RepoIndex = parseIndex(bytes(index({}, [entry({ minAppVersion: '0.2.0' })])));
    expect(parsed.name).toBe('Test repo');
    expect(parsed.extensions[0]?.minAppVersion).toBe('0.2.0');
  });

  it('accepts an empty repository and absolute http(s) references', () => {
    expect(parseIndex(bytes(index({}, []))).extensions).toEqual([]);
    const parsed = parseIndex(
      bytes(index({}, [entry({ archive: 'https://cdn.example/a.zip', icon: 'http://cdn.example/a.png' })])),
    );
    expect(parsed.extensions[0]?.archive).toBe('https://cdn.example/a.zip');
  });

  it('ignores unknown fields for forward compatibility', () => {
    expect(parseIndex(bytes({ ...index(), future: true })).serial).toBe(3);
  });

  it('rejects an index over the size limit before parsing it', () => {
    expect(codeOf(() => parseIndex(new Uint8Array(MAX_INDEX_BYTES + 1)))).toBe('index_too_large');
    expect(codeOf(() => parseIndex(new Uint8Array(MAX_INDEX_BYTES)))).toBe('bad_index');
  });

  it('rejects invalid UTF-8 and invalid JSON', () => {
    expect(codeOf(() => parseIndex(Uint8Array.of(0xff, 0xfe, 0x7b)))).toBe('bad_index');
    expect(codeOf(() => parseIndex(new TextEncoder().encode('{nope')))).toBe('bad_index');
    expect(codeOf(() => parseIndex(new TextEncoder().encode('')))).toBe('bad_index');
    expect(codeOf(() => parseIndex(new TextEncoder().encode('null')))).toBe('bad_index');
  });

  it.each<[string, Record<string, unknown>]>([
    ['unknown format', { format: 2 }],
    ['missing name', { name: '' }],
    ['negative serial', { serial: -1 }],
    ['fractional serial', { serial: 1.5 }],
    ['string serial', { serial: '3' }],
    ['bad date', { generatedAt: 'yesterday' }],
  ])('rejects %s', (_label, overrides) => {
    expect(codeOf(() => parseIndex(bytes(index(overrides))))).toBe('bad_index');
  });

  it.each<[string, Record<string, unknown>]>([
    ['id with upper case', { id: 'Demo' }],
    ['id starting with a digit', { id: '1demo' }],
    ['non-semver version', { version: '1.0' }],
    ['zero apiVersion', { apiVersion: 0 }],
    ['non-boolean nsfw', { nsfw: 'no' }],
    ['bad minAppVersion', { minAppVersion: 'new' }],
    ['uppercase hash', { sha256: 'A'.repeat(64) }],
    ['short hash', { sha256: 'a'.repeat(63) }],
    ['zero size', { size: 0 }],
    ['archive over 20 MB', { size: 20 * 1024 * 1024 + 1 }],
    ['icon over 512 KB', { iconSize: 512 * 1024 + 1 }],
    ['bad lang', { langs: ['English'] }],
    ['ftp archive', { archive: 'ftp://host/a.zip' }],
    ['javascript icon', { icon: 'javascript:alert(1)' }],
    ['file archive', { archive: 'file:///etc/passwd' }],
    ['data icon', { icon: 'data:image/png;base64,AAAA' }],
    ['protocol-relative archive', { archive: '//host/a.zip' }],
    ['backslash path', { archive: 'dir\\a.zip' }],
    ['empty archive', { archive: '' }],
    ['space in path', { archive: 'a b.zip' }],
  ])('rejects an entry with %s', (_label, overrides) => {
    expect(codeOf(() => parseIndex(bytes(index({}, [entry(overrides)]))))).toBe('bad_index');
  });

  it('accepts the sizes exactly at the limits', () => {
    const limits = entry({ size: 20 * 1024 * 1024, iconSize: 512 * 1024 });
    expect(parseIndex(bytes(index({}, [limits]))).extensions).toHaveLength(1);
  });

  it('rejects duplicate ids', () => {
    expect(codeOf(() => parseIndex(bytes(index({}, [entry(), entry({ version: '2.0.0' })]))))).toBe('bad_index');
  });

  it('reports a short message, never a raw zod error', () => {
    try {
      parseIndex(bytes(index({ serial: -1 })));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RepoError);
      expect((error as RepoError).message).toContain('serial');
      expect((error as RepoError).message.length).toBeLessThan(200);
    }
  });
});

describe('resolveUrl', () => {
  it('resolves relative references against the index URL', () => {
    expect(resolveUrl('https://example.org/repo/index.json', 'a.zip')).toBe('https://example.org/repo/a.zip');
    expect(resolveUrl('https://example.org/repo/index.json', 'sub/a.zip')).toBe('https://example.org/repo/sub/a.zip');
    expect(resolveUrl('http://localhost:8080/index.json', 'a%20b')).toBe('http://localhost:8080/a%20b');
  });

  it('keeps absolute http(s) URLs', () => {
    expect(resolveUrl('https://example.org/index.json', 'https://cdn.example/a.zip')).toBe('https://cdn.example/a.zip');
    expect(resolveUrl('https://example.org/index.json', 'http://cdn.example/a.zip')).toBe('http://cdn.example/a.zip');
  });

  it.each([
    'ftp://x/a.zip',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/plain,hi',
    '//evil/a.zip',
    'a\\b',
    '',
  ])('rejects %j', (ref) => {
    expect(codeOf(() => resolveUrl('https://example.org/index.json', ref))).toBe('bad_url');
  });

  it('rejects a base that is not http(s)', () => {
    expect(codeOf(() => resolveUrl('file:///repo/index.json', 'a.zip'))).toBe('bad_url');
    expect(codeOf(() => resolveUrl('not a url', 'a.zip'))).toBe('bad_url');
  });
});
