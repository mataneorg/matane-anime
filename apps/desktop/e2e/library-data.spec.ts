import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 2, milestone 2a: library, categories, progress and covers through the real IPC, and that they
// survive a restart of the app on the same profile.

const ROOT = resolve(__dirname, '../../..');
const EXAMPLE = resolve(ROOT, 'extensions/example');
const DURATION = 1_440_000;

test.describe.configure({ mode: 'serial' });

let site: TestSite;
let app: ElectronApplication;
let page: Page;
let userData: string;

const invoke = <T = unknown>(channel: string, input?: unknown): Promise<T> =>
  page.evaluate(
    ([c, i]) =>
      (window as unknown as { api: { invoke(c: string, i?: unknown): Promise<unknown> } }).api.invoke(c as string, i),
    [channel, input] as const,
  ) as Promise<T>;

interface Item {
  animeId: number;
  title: string;
  hasLocalCover: boolean;
  categoryIds: number[];
  total: number;
  unwatched: number;
  lastEpisode: { episodeId: number; number: number | null; positionMs: number; watched: boolean } | null;
  continue: { episodeId: number; number: number | null; reason: string; resumeMs: number } | null;
}
const library = (query: Record<string, unknown> = {}) => invoke<Item[]>('library.list', { sort: 'title', ...query });

async function start(): Promise<void> {
  ({ app, page, userData } = await launchApp({}, userData ? { userData } : {}));
  await page.waitForSelector('nav', { timeout: 30_000 });
}

test.beforeAll(async () => {
  site = await TestSite.start({ mediaDir: resolve(__dirname, 'fixtures/media') });
  execFileSync(process.execPath, [resolve(ROOT, 'packages/extension-cli/dist/cli.js'), 'build', EXAMPLE], {
    stdio: 'pipe',
  });
  await start();
  await invoke('extensions.loadDevFolder', { folder: EXAMPLE });
  await invoke('extensions.setPreference', { extensionId: 'example', key: 'baseUrl', value: site.origin });
});
test.afterAll(async () => {
  await app?.close();
  await site?.close();
});

let animeId = 0;
let watching = 0;
let firstEpisode = 0;

test('adds an anime to the library with categories, and saves its cover on disk', async () => {
  const found = await invoke<{ items: { animeId: number; title: string }[] }>('sources.browse', {
    sourceId: 'example/en',
    kind: 'search',
    page: 1,
    query: 'Sky Harbor',
  });
  animeId = found.items[0]!.animeId;
  const { episodes } = await invoke<{ episodes: { id: number; number: number }[] }>('anime.refresh', { animeId });
  firstEpisode = episodes.find((e) => e.number === 1)!.id;

  expect(await library()).toEqual([]);
  watching = (await invoke<{ id: number }>('categories.create', { name: 'Watching' })).id;
  await invoke('library.add', { animeId, categoryIds: [watching] });
  await expect.poll(async () => (await library())[0]?.hasLocalCover, { timeout: 10_000 }).toBe(true);

  const [item] = await library();
  expect(item).toMatchObject({
    title: 'Sky Harbor',
    categoryIds: [watching],
    total: 12,
    unwatched: 12,
    lastEpisode: null,
    continue: { number: 1, reason: 'first' },
  });
  expect(await invoke('categories.list')).toEqual([expect.objectContaining({ name: 'Watching', count: 1 })]);

  // The permanent cover is served from disk through anime://cover/library/<id>.
  const cover = await page.evaluate(async (id) => {
    const response = await fetch(`anime://cover/library/${id}`);
    return {
      status: response.status,
      type: response.headers.get('content-type'),
      bytes: (await response.arrayBuffer()).byteLength,
    };
  }, animeId);
  expect(cover).toMatchObject({ status: 200, type: 'image/svg+xml' });
  expect(cover.bytes).toBeGreaterThan(100);
});

test('records progress through the single door, then resumes three seconds before it', async () => {
  const send = (reason: string, positionMs: number) =>
    invoke('watch.progress', { playbackId: 'e2e', episodeId: firstEpisode, positionMs, durationMs: DURATION, reason });
  await send('play', 0);
  // Real playing time: history is only written after five seconds of it.
  await new Promise((resolve) => setTimeout(resolve, 5300));
  await send('heartbeat', 300_000);
  await send('pause', 300_000);

  const [item] = await library();
  expect(item!.lastEpisode).toMatchObject({ episodeId: firstEpisode, positionMs: 300_000, watched: false });
  expect(item!.continue).toMatchObject({ episodeId: firstEpisode, reason: 'resume', resumeMs: 297_000 });
  expect(await invoke('watch.continueTarget', { animeId })).toMatchObject({
    episodeId: firstEpisode,
    resumeMs: 297_000,
  });

  // The player is told where to start.
  const session = await invoke<{ resumeMs: number; playbackId: string }>('playback.start', { episodeId: firstEpisode });
  expect(session.resumeMs).toBe(297_000);
  await invoke('playback.close', { playbackId: session.playbackId });
});

test('marks watched at the threshold, for the whole number, and moves "continue" on', async () => {
  const dubbed = await invoke<{ items: { animeId: number; title: string }[] }>('sources.browse', {
    sourceId: 'example/en',
    kind: 'search',
    page: 1,
    query: 'Two Voices',
  });
  const voices = dubbed.items[0]!.animeId;
  const { episodes } = await invoke<{ episodes: { id: number; number: number; variant: string }[] }>('anime.refresh', {
    animeId: voices,
  });
  await invoke('library.add', { animeId: voices, categoryIds: [] });
  const sub = episodes.find((e) => e.number === 1 && e.variant === 'Sub')!;
  const dub = episodes.find((e) => e.number === 1 && e.variant === 'Dub')!;

  const result = await invoke<{ watched: boolean }>('watch.progress', {
    playbackId: 'e2e-2',
    episodeId: sub.id,
    positionMs: 0.9 * DURATION,
    durationMs: DURATION,
    reason: 'heartbeat',
  });
  expect(result.watched).toBe(true);
  const after = await invoke<{ id: number; watched: boolean }[]>('episodes.list', { animeId: voices });
  expect(after.find((e) => e.id === dub.id)?.watched).toBe(true);
  expect((await library({ search: 'voices' }))[0]).toMatchObject({ total: 6, unwatched: 5 });
  expect(await invoke('watch.continueTarget', { animeId: voices })).toMatchObject({ number: 2, reason: 'next' });
});

test('keeps everything across a restart of the app on the same profile', async () => {
  await app.close();
  await start();
  const items = await library();
  expect(items.map((i) => i.title)).toEqual(['Sky Harbor', 'Two Voices']);
  const sky = items.find((i) => i.title === 'Sky Harbor')!;
  expect(sky).toMatchObject({
    categoryIds: [watching],
    hasLocalCover: true,
    lastEpisode: { positionMs: 300_000 },
    continue: { reason: 'resume', resumeMs: 297_000 },
  });
  expect(await invoke('categories.list')).toEqual([expect.objectContaining({ name: 'Watching', count: 1 })]);
  const history = await invoke<{ title: string }[]>('history.list');
  expect(history.map((h) => h.title)).toContain('Sky Harbor');
});

test('removes from the library and clears history without touching progress', async () => {
  await invoke('history.clear');
  expect(await invoke('history.list')).toEqual([]);
  await invoke('library.remove', { animeId });
  expect((await library()).map((i) => i.title)).toEqual(['Two Voices']);
  // Progress outlives the library entry: adding it back finds it where it was.
  await invoke('library.add', { animeId, categoryIds: [] });
  // The card forgets which episode was last (that came from the history), but the saved position is still
  // there: "continue" picks the episode up where it was.
  expect((await library({ search: 'sky' }))[0]!.continue).toMatchObject({ episodeId: firstEpisode, resumeMs: 297_000 });
});
