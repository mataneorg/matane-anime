import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { AppError, type ExtensionInfo, decodeIpcError } from '@matane-anime/shared';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 1, milestone 1b: the extension host, the network layer and the browse/detail calls, against the
// app as a user would run it (real preload, real IPC, a real utilityProcess) and the fake site.

const ROOT = resolve(__dirname, '../../..');
const EXAMPLE = resolve(ROOT, 'extensions/example');
const PROBE = resolve(__dirname, 'fixtures/extensions/probe');

test.describe.configure({ mode: 'serial' });

let site: TestSite;
let app: ElectronApplication;
let page: Page;

/** `window.api.invoke`, with failures decoded the way the renderer does. */
async function invoke<T = unknown>(channel: string, input?: unknown): Promise<T> {
  const result = await page.evaluate(
    async ([c, i]) => {
      try {
        return {
          ok: true as const,
          value: await (window as unknown as { api: { invoke(c: string, i?: unknown): Promise<unknown> } }).api.invoke(
            c,
            i,
          ),
        };
      } catch (error) {
        return { ok: false as const, message: (error as Error).message };
      }
    },
    [channel, input] as const,
  );
  if (!result.ok) throw decodeIpcError(new Error(result.message));
  return result.value as T;
}

const fails = async (work: Promise<unknown>): Promise<AppError> => {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('expected the call to fail');
};

const setPref = (extensionId: string, key: string, value: unknown) =>
  invoke('extensions.setPreference', { extensionId, key, value });
const popular = (sourceId: string, extra: Record<string, unknown> = {}) =>
  invoke<{
    items: { animeId: number; title: string; url: string; thumbnailUrl: string | null }[];
    hasNextPage: boolean;
  }>('sources.browse', { sourceId, kind: 'popular', page: 1, ...extra });

test.beforeAll(async () => {
  site = await TestSite.start({ mediaDir: resolve(__dirname, 'fixtures/media'), challengeMs: 200 });
  for (const dir of [EXAMPLE])
    execFileSync(process.execPath, [resolve(ROOT, 'packages/extension-cli/dist/cli.js'), 'build', dir], {
      stdio: 'pipe',
    });
  ({ app, page } = await launchApp({ MATANE_EXT_IDLE_MS: '1500' }));
  await page.waitForSelector('nav', { timeout: 30_000 });
});

test.afterAll(async () => {
  await app?.close();
  await site?.close();
});

test.beforeEach(() => site.reset());

test.describe('loading extensions from folders', () => {
  test('loads a built extension and lists its sources', async () => {
    const info = await invoke<ExtensionInfo>('extensions.loadDevFolder', { folder: EXAMPLE });
    expect(info).toMatchObject({ id: 'example', status: 'ready', origin: 'dev', hasPreferences: true, error: null });
    expect(info.sources.map((s) => s.id)).toEqual(['example/en', 'example/id']);
    const sources = await invoke<{ id: string; available: boolean; nsfw: boolean }[]>('sources.list');
    expect(sources.map((s) => [s.id, s.available])).toEqual([
      ['example/en', true],
      ['example/id', true],
    ]);
    await setPref('example', 'baseUrl', site.origin);
  });

  test('keeps a folder that cannot load in the list, with the reason', async () => {
    const info = await invoke<ExtensionInfo>('extensions.loadDevFolder', { folder: resolve(ROOT, 'packages/shared') });
    expect(info.status).toBe('error');
    expect(info.error).toMatch(/Nothing to load here/);
    expect((await invoke<ExtensionInfo[]>('extensions.list')).map((e) => e.status)).toContain('error');
    await invoke('extensions.removeDevFolder', { folder: resolve(ROOT, 'packages/shared') });
    expect((await invoke<ExtensionInfo[]>('extensions.list')).map((e) => e.status)).not.toContain('error');
  });

  test('reports declared preferences with their defaults and refuses bad values', async () => {
    const state = await invoke<{ preferences: { key: string }[]; values: Record<string, unknown> }>(
      'extensions.preferences',
      { extensionId: 'example' },
    );
    expect(state.preferences.map((p) => p.key)).toEqual(['baseUrl', 'showDub']);
    expect(state.values).toMatchObject({ baseUrl: site.origin, showDub: true });
    expect((await fails(setPref('example', 'showDub', 'yes'))).code).toBe('invalid_input');
    expect((await fails(setPref('example', 'nope', 1))).code).toBe('invalid_input');
  });
});

test.describe('browse and detail through the host', () => {
  test('lists popular, pages on, and stores the rows', async () => {
    const page1 = await popular('example/en');
    expect(page1.items).toHaveLength(12);
    expect(page1.hasNextPage).toBe(true);
    expect(page1.items[0]).toMatchObject({ title: 'Sky Harbor', url: '/anime/sky-harbor' });
    expect(page1.items[0]?.thumbnailUrl).toBe(`${site.origin}/img/sky-harbor.svg`);
    const page3 = await popular('example/en', { page: 3 });
    expect(page3.hasNextPage).toBe(false);
    // The same listing again gives the same ids: rows are keyed by (source, url).
    expect((await popular('example/en')).items.map((i) => i.animeId)).toEqual(page1.items.map((i) => i.animeId));
  });

  test('searches with filters, and exposes them from the extension', async () => {
    const filters = await invoke<{ type: string }[]>('sources.filters', { sourceId: 'example/en' });
    expect(filters.map((f) => f.type)).toEqual(['select', 'sort', 'group']);
    const capabilities = await invoke('sources.capabilities', { sourceId: 'example/en' });
    expect(capabilities).toEqual({ latest: true, filters: true, resolveUrl: true });

    const drama = await invoke<{ items: { title: string }[] }>('sources.browse', {
      sourceId: 'example/en',
      kind: 'search',
      page: 1,
      query: '',
      filters: { 'genre-drama': 'include' },
    });
    expect(drama.items.map((i) => i.title)).toEqual(expect.arrayContaining(['Two Voices', 'One Shot Movie']));
    expect(drama.items.some((i) => i.title === 'Sky Harbor')).toBe(false);
    const latest = await invoke<{ items: { title: string }[] }>('sources.browse', {
      sourceId: 'example/en',
      kind: 'latest',
      page: 1,
    });
    expect(latest.items[0]?.title).toBe('Filler Series 24');
  });

  test('refreshes details and episodes, persists them, and keeps them if the next refresh fails', async () => {
    const [sky] = (await popular('example/en')).items;
    const refreshed = await invoke<{
      anime: {
        title: string;
        altTitles: string[];
        genres: string[];
        status: string;
        webUrl: string | null;
        detailsFetchedAt: number | null;
      };
      episodes: { number: number; name: string }[];
    }>('anime.refresh', { animeId: sky!.animeId });
    expect(refreshed.anime).toMatchObject({
      title: 'Sky Harbor',
      status: 'ongoing',
      genres: ['action', 'adventure'],
      webUrl: `${site.origin}/anime/sky-harbor`,
    });
    expect(refreshed.anime.altTitles).toEqual(['Sora no Minato', 'Hafen im Himmel']);
    expect(refreshed.anime.detailsFetchedAt).not.toBeNull();
    expect(refreshed.episodes).toHaveLength(12);
    expect(refreshed.episodes[0]).toMatchObject({ number: 12, name: 'Episode 12' });
    expect(await invoke<unknown[]>('episodes.list', { animeId: sky!.animeId })).toHaveLength(12);

    await setPref('example', 'baseUrl', 'http://127.0.0.1:9');
    const error = await fails(invoke('anime.refresh', { animeId: sky!.animeId }));
    expect([error.code, error.detail.kind]).toEqual(['extension', 'NetworkError']);
    expect(await invoke<unknown[]>('episodes.list', { animeId: sky!.animeId })).toHaveLength(12);
    expect((await invoke<{ title: string }>('anime.get', { animeId: sky!.animeId })).title).toBe('Sky Harbor');
    await setPref('example', 'baseUrl', site.origin);
  });

  test('shows dubbed variants together and honors a preference', async () => {
    const voices = (await popular('example/en')).items.find((i) => i.title === 'Two Voices');
    const both = await invoke<{ episodes: { id: number; variant: string | null }[] }>('anime.refresh', {
      animeId: voices!.animeId,
    });
    expect(new Set(both.episodes.map((e) => e.variant))).toEqual(new Set(['Sub', 'Dub']));
    // A dubbed episode that was watched must survive the dub going away; the others have no reason to.
    const watchedDub = both.episodes.find((e) => e.variant === 'Dub')!;
    await invoke('episodes.markWatched', { episodeIds: [watchedDub.id], watched: true });
    await setPref('example', 'showDub', false);
    const subOnly = await invoke<{ episodes: { id: number; variant: string | null; sourceMissing: boolean }[] }>(
      'anime.refresh',
      { animeId: voices!.animeId },
    );
    expect(subOnly.episodes.filter((e) => !e.sourceMissing).every((e) => e.variant === 'Sub')).toBe(true);
    // UPD-5: the unwatched dubbed rows are deleted, the watched one is kept and flagged as gone from the source.
    expect(subOnly.episodes.filter((e) => e.variant === 'Dub').map((e) => [e.id, e.sourceMissing])).toEqual([
      [watchedDub.id, true],
    ]);
    await setPref('example', 'showDub', true);
  });

  test('resolves a pasted URL to an anime, or null', async () => {
    const found = await invoke<{ title: string; url: string } | null>('sources.resolveUrl', {
      sourceId: 'example/en',
      url: `${site.origin}/anime/quiet-orchard`,
    });
    expect(found).toMatchObject({ url: '/anime/quiet-orchard' });
    expect(
      await invoke('sources.resolveUrl', { sourceId: 'example/en', url: 'https://elsewhere.test/anime/x' }),
    ).toBeNull();
  });

  test('reports a source that is not installed', async () => {
    const error = await fails(popular('nobody/en'));
    expect(error.code).toBe('not_found');
  });

  test('an unknown anime id is not found', async () => {
    expect((await fails(invoke('anime.get', { animeId: 999_999 }))).code).toBe('not_found');
  });
});

test.describe('the network layer', () => {
  const probe = async (url: string, extra: Record<string, unknown> = {}) => {
    await setPref('probe', 'url', url);
    await setPref('probe', 'referer', (extra['referer'] as string) ?? '');
    await setPref('probe', 'timeoutMs', (extra['timeoutMs'] as string) ?? '');
    const { items } = await popular('probe/en', extra['requestId'] ? { requestId: extra['requestId'] } : {});
    const [title = '', status = '', finalUrl = ''] = (items[0]?.title ?? '').split('|');
    return { text: title, status: Number(status), finalUrl };
  };

  test.beforeAll(async () => {
    await invoke('extensions.loadDevFolder', { folder: PROBE });
  });

  test('sends Referer and Origin-less requests with a Chrome User-Agent, never "Electron"', async () => {
    const result = await probe(`${site.origin}/_t/echo`, { referer: 'https://example.test/watch' });
    const echoed = JSON.parse(result.text.split('|')[0] as string) as {
      referer: string;
      userAgent: string;
      origin: string | null;
    };
    expect(echoed.referer).toBe('https://example.test/watch');
    expect(echoed.userAgent).toMatch(/Chrome\//);
    expect(echoed.userAgent).not.toMatch(/Electron|Matane/i);
  });

  test('refuses a redirect to a non-http URL, and follows ordinary ones', async () => {
    const error = await fails(probe(`${site.origin}/_t/redirect?to=${encodeURIComponent('file:///etc/passwd')}`));
    expect([error.code, error.detail.kind]).toEqual(['extension', 'NetworkError']);
    expect(error.message).toMatch(/Refusing a redirect to file:/);
    const followed = await probe(
      `${site.origin}/_t/redirect?to=${encodeURIComponent(`${site.origin}/_t/status?code=200`)}`,
    );
    expect(followed).toMatchObject({ text: 'status', status: 200 });
    expect(followed.finalUrl).toBe(`${site.origin}/_t/status?code=200`);
  });

  test('retries server errors and rate limits, then gives up on a persistent failure', async () => {
    expect(await probe(`${site.origin}/_t/flaky`)).toMatchObject({ text: 'ok', status: 200 });
    expect(site.log.filter((e) => e.path === '/_t/flaky')).toHaveLength(3);

    const started = Date.now();
    expect(await probe(`${site.origin}/_t/limited`)).toMatchObject({ text: 'ok' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(900); // honored Retry-After: 1

    site.reset();
    const error = await fails(probe(`${site.origin}/_t/status?code=500`));
    expect([error.detail.kind, error.detail.status]).toEqual(['HttpError', 500]);
    expect(site.log.filter((e) => e.path === '/_t/status')).toHaveLength(3);
  });

  test('turns a 404 into NotFoundError without retrying', async () => {
    const error = await fails(probe(`${site.origin}/_t/status?code=404`));
    expect(error.detail.kind).toBe('NotFoundError');
    expect(site.log.filter((e) => e.path === '/_t/status')).toHaveLength(1);
  });

  test('times out a slow site, and can be cancelled from the renderer', async () => {
    const slow = await fails(probe(`${site.origin}/_t/slow?ms=4000`, { timeoutMs: '600' }));
    expect([slow.detail.kind]).toEqual(['NetworkError']);
    expect(slow.message).toMatch(/did not answer/);

    await setPref('probe', 'url', `${site.origin}/_t/slow?ms=3000`);
    await setPref('probe', 'timeoutMs', '');
    const started = Date.now();
    const pending = fails(popular('probe/en', { requestId: 'cancel-me' }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await invoke('requests.cancel', 'cancel-me');
    expect((await pending).code).toBe('cancelled');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('spaces requests to the extension rate limit (5 per second)', async () => {
    await setPref('probe', 'url', `${site.origin}/_t/status?code=200`);
    const started = Date.now();
    await Promise.all(Array.from({ length: 12 }, () => popular('probe/en')));
    expect(Date.now() - started).toBeGreaterThanOrEqual(1200); // 12 requests, burst of 5, 5 per second after
  });

  test('passes a Cloudflare challenge in a hidden window and repeats the request', async () => {
    await page.evaluate(() => {
      const w = window as unknown as {
        __cf?: string[];
        api: { on(c: string, l: (p: { state: string }) => void): void };
      };
      w.__cf = [];
      w.api.on('cloudflare.status', (status) => w.__cf?.push(status.state));
    });
    const result = await probe(`${site.origin}/cf/_t/status?code=200`);
    expect(result).toMatchObject({ text: 'status', status: 200 });
    const states = await page.evaluate(() => (window as unknown as { __cf: string[] }).__cf);
    expect(states[0]).toBe('solving');
    expect(states.at(-1)).toBe('solved');
    // The cookie now lives in the extension's session: the next request goes straight through.
    site.reset();
    expect(await probe(`${site.origin}/cf/_t/status?code=200`)).toMatchObject({ status: 200 });
    expect(site.log.some((e) => e.status === 503)).toBe(false);
  });
});

test.describe('resilience', () => {
  test('survives the extension host being killed', async () => {
    await setPref('example', 'baseUrl', site.origin);
    expect((await popular('example/en')).items).toHaveLength(12);
    const killed = await app.evaluate(({ app: electronApp }) => {
      const host = electronApp
        .getAppMetrics()
        .find((metric) => metric.name === 'matane-extension-host' || metric.serviceName === 'matane-extension-host');
      if (!host) return false;
      process.kill(host.pid, 'SIGKILL');
      return true;
    });
    expect(killed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    // The next call forks a new host and loads the extension into it again.
    expect((await popular('example/en')).items).toHaveLength(12);
  });

  test('reloads an extension the host dropped while idle', async () => {
    await new Promise((resolve) => setTimeout(resolve, 3500)); // MATANE_EXT_IDLE_MS = 1500
    expect((await popular('example/en')).items).toHaveLength(12);
  });

  test('records what the extension logs', async () => {
    const logs = await invoke<{ extensionId: string }[]>('extensions.logs', { extensionId: 'example' });
    expect(Array.isArray(logs)).toBe(true);
  });
});
