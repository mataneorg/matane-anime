import type { ExtensionManifest } from '@matane-anime/extension-sdk/manifest';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExtensionRuntimeError } from './errors';
import { streamSchema } from './results';
import { type HostApi, ExtensionRuntime } from './runtime';
import { SourceClient } from './source-client';

const manifest: ExtensionManifest = {
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  apiVersion: 1,
  type: 'anime',
  nsfw: false,
  sources: [{ key: 'en', lang: 'en', name: 'Test' }],
};

const created: ExtensionRuntime[] = [];
afterEach(() => {
  for (const runtime of created.splice(0)) runtime.dispose();
});

async function client(methods: string, onWarning?: (message: string) => void): Promise<SourceClient> {
  const host: HostApi = {
    http: async () => ({ status: 200, url: 'https://site.test/', headers: {}, text: '' }),
    storage: { get: async () => null, set: async () => undefined, remove: async () => undefined },
    log: () => undefined,
  };
  const runtime = await ExtensionRuntime.create({
    code: `globalThis.__extension = { createSource() { return { ${methods} }; }, preferences() { return [{ type: 'text', key: 'k', label: 'K', default: '' }]; } };`,
    manifest,
    host,
    hostInfo: { appName: 'Matane Anime', appVersion: '0.0.0', apiVersion: 1 },
  });
  created.push(runtime);
  return SourceClient.forRuntime(runtime, 'en', onWarning);
}

const reject = async (promise: Promise<unknown>): Promise<ExtensionRuntimeError> => {
  try {
    await promise;
  } catch (error) {
    return error as ExtensionRuntimeError;
  }
  throw new Error('expected a failure');
};

describe('SourceClient', () => {
  it('normalizes what extensions return: nulls become absent, status defaults to unknown', async () => {
    const source = await client(`
      getPopular() { return { items: [{ url: '/a', title: 'A', thumbnailUrl: null }], hasNextPage: true }; },
      getAnimeDetails() { return { url: '/a', title: 'A', status: null, year: null, genres: ['x'] }; },
      getEpisodes() { return [{ url: '/e1', name: 'Ep 1', number: 1, variant: null }]; }`);
    expect(await source.getPopular(1)).toEqual({ items: [{ url: '/a', title: 'A' }], hasNextPage: true });
    expect(await source.getAnimeDetails({ url: '/a', title: 'A' })).toMatchObject({ status: 'unknown', genres: ['x'] });
    const [episode] = await source.getEpisodes({ url: '/a', title: 'A' });
    expect(episode).toEqual({ url: '/e1', name: 'Ep 1', number: 1 });
  });

  it('rejects results that break the contract, naming the method', async () => {
    const source = await client(`
      getPopular() { return { items: [{ url: '/a' }], hasNextPage: 'yes' }; },
      getEpisodes() { return [{ url: '/e', name: 'x', number: 'one' }]; }`);
    const popular = await reject(source.getPopular(1));
    expect(popular.code).toBe('invalid_result');
    expect(popular.message).toMatch(/getPopular returned data that does not match the contract/);
    expect((await reject(source.getEpisodes({ url: '/a', title: 'A' }))).code).toBe('invalid_result');
  });

  it('treats an empty stream list as NotFoundError', async () => {
    const source = await client(`getStreams() { return []; }`);
    const error = await reject(source.getStreams({ url: '/e', name: 'Ep' }));
    expect([error.code, error.typed]).toEqual(['extension', 'NotFoundError']);
  });

  it('only accepts http(s) stream URLs and drops headers the host owns', async () => {
    const source = await client(`
      getStreams(episode) {
        if (episode.url === '/bad') return [{ url: 'javascript:alert(1)', server: 'A' }];
        return [{ url: 'https://cdn.test/v.m3u8', server: 'A', quality: 1080,
          headers: { Referer: 'https://site.test/', Cookie: 'x=1', Host: 'evil', 'content-length': '1' } }]; }`);
    expect((await reject(source.getStreams({ url: '/bad', name: 'x' }))).code).toBe('invalid_result');
    const [stream] = await source.getStreams({ url: '/ok', name: 'x' });
    expect(stream?.headers).toEqual({ Referer: 'https://site.test/' });
    expect(streamSchema.safeParse({ url: 'ftp://x/y', server: 'A' }).success).toBe(false);
  });

  it('repairs small slips in a stream and drops only the stream that is beyond repair', async () => {
    const warnings: string[] = [];
    const source = await client(
      `getStreams() { return [
        { url: '//cdn.test/a.m3u8', server: 'A', quality: '1080p' },
        { url: 'https://cdn.test/b.mp4', server: '', quality: 719.6, kind: 'dash' },
        { url: 'https://cdn.test/c.m3u8', server: 'C', quality: '1920x1080' },
        { url: 'ftp://cdn.test/d', server: 'D' },
        { url: 'https://cdn.test/e.m3u8', server: 'E', quality: 'HD' },
      ]; }`,
      (message) => warnings.push(message),
    );
    const streams = await source.getStreams({ url: '/e', name: 'Ep' });
    expect(streams.map((s) => [s.server, s.url, s.quality, s.kind])).toEqual([
      ['A', 'https://cdn.test/a.m3u8', 1080, undefined],
      ['cdn.test', 'https://cdn.test/b.mp4', 720, undefined],
      ['C', 'https://cdn.test/c.m3u8', 1080, undefined],
      ['E', 'https://cdn.test/e.m3u8', undefined, undefined],
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/dropped 1 stream\(s\): #4/);
  });

  it('still fails when no stream can be read, and when the result is not a list', async () => {
    const none = await client(`getStreams() { return [{ url: 'ftp://x/y', server: 'A' }]; }`);
    expect((await reject(none.getStreams({ url: '/e', name: 'x' }))).code).toBe('invalid_result');
    const notAList = await client(`getStreams() { return { url: 'https://x/y' }; }`);
    expect((await reject(notAList.getStreams({ url: '/e', name: 'x' }))).code).toBe('invalid_result');
  });

  it('reads optional methods only when the source has them', async () => {
    const without = await client(`getPopular() { return { items: [], hasNextPage: false }; }`);
    expect(await without.getFilters()).toEqual([]);
    expect(await without.resolveUrl('https://site.test/a')).toBeNull();
    expect(await without.getWebUrl({ url: '/a', title: 'A' })).toBeNull();
    expect(await without.migrateUrl('/a', 'anime', '1.0.0')).toBeNull();

    const full = await client(`
      getFilters() { return [{ type: 'group', id: 'genres', label: 'Genres', filters: [{ type: 'tristate', id: 'action', label: 'Action' }] }]; },
      resolveUrl(url) { return url.includes('/anime/') ? { url: '/a', title: 'A' } : null; },
      getWebUrl(item) { return 'https://site.test' + item.url; },
      migrateUrl(url) { return url === '/old' ? '/new' : url; }`);
    expect(await full.getFilters()).toHaveLength(1);
    expect(await full.resolveUrl('https://site.test/anime/a')).toEqual({ url: '/a', title: 'A' });
    expect(await full.resolveUrl('https://site.test/other')).toBeNull();
    expect(await full.getWebUrl({ url: '/a', title: 'A' })).toBe('https://site.test/a');
    expect(await full.migrateUrl('/old', 'anime', '1.0.0')).toBe('/new');
    expect(await full.migrateUrl('/same', 'anime', '1.0.0')).toBeNull();
  });

  it('validates the declared preferences', async () => {
    const source = await client(`x() {}`);
    expect(await source.preferences()).toEqual([{ type: 'text', key: 'k', label: 'K', default: '' }]);
  });
});
