import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 3, milestone 3i: the whole of phase 3 as one person would use it. Add to the library, download (HLS and
// MP4), the site goes away, watch offline (also after restarting the app), the site comes back with a new
// episode, the update check finds it, auto-download fetches it, and marking it watched clears it.

const ROOT = resolve(__dirname, '../../..');
const EXAMPLE = resolve(ROOT, 'extensions/example');
const SHOTS = resolve(__dirname, '../test-results/screens');

test.describe.configure({ mode: 'serial' });

let site: TestSite;
let app: ElectronApplication;
let page: Page;
let userData: string;
let folder: string;

const go = (hash: string) =>
  page.evaluate((value) => {
    window.location.hash = value;
  }, hash);
const invoke = <T = unknown>(channel: string, input?: unknown): Promise<T> =>
  page.evaluate(
    ([c, i]) =>
      (window as unknown as { api: { invoke(c: string, i?: unknown): Promise<unknown> } }).api.invoke(c as string, i),
    [channel, input] as const,
  ) as Promise<T>;
const shot = (name: string) => page.screenshot({ path: resolve(SHOTS, `phase3-${name}.png`) });

interface Row {
  episodeId: number;
  episodeNumber: number | null;
  animeTitle: string;
  status: string;
  kind: 'hls' | 'mp4';
  bytesDone: number;
  error: string | null;
}
const downloads = () => invoke<Row[]>('downloads.list');
const rowOf = async (episodeId: number) => (await downloads()).find((item) => item.episodeId === episodeId);
const sidebarUpdates = () => page.locator('aside').getByRole('link', { name: /^Updates/ });
const updateRows = () =>
  page
    .getByRole('list')
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: 'Play' }) });
const video = () =>
  page.locator('video').evaluate((v: HTMLVideoElement) => ({
    time: v.currentTime,
    duration: v.duration,
    width: v.videoWidth,
    src: v.currentSrc || v.src,
  }));

/** Finds a series of the test site through search, loads its episodes and returns them by number. */
async function series(title: string): Promise<{ animeId: number; episodes: Record<number, number> }> {
  const found = await invoke<{ items: { animeId: number; title: string }[] }>('sources.browse', {
    sourceId: 'example/en',
    kind: 'search',
    page: 1,
    query: title,
  });
  const anime = found.items.find((item) => item.title === title);
  if (!anime) throw new Error(`No anime ${title}`);
  const { episodes } = await invoke<{ episodes: { id: number; number: number }[] }>('anime.refresh', {
    animeId: anime.animeId,
  });
  return { animeId: anime.animeId, episodes: Object.fromEntries(episodes.map((e) => [e.number, e.id])) };
}

/** Every file below `root`, absolute. */
function files(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

async function ready(): Promise<void> {
  await page.waitForSelector('nav', { timeout: 30_000 });
  await expect
    .poll(async () => (await invoke<{ id: string }[]>('sources.list')).map((s) => s.id), { timeout: 20_000 })
    .toContain('example/en');
}

/** Plays an episode in the player and checks that it comes from disk: time advances, no request goes out. */
async function playOffline(episodeId: number, options: { seek?: boolean } = {}): Promise<void> {
  const requests = site.log.length;
  await go(`#/watch/${episodeId}`);
  await expect.poll(async () => (await video()).time, { timeout: 20_000 }).toBeGreaterThan(0.8);
  // The size and the duration come with the first frames; poll rather than read them once.
  await expect.poll(async () => (await video()).width, { timeout: 10_000 }).toBeGreaterThan(0);
  const state = await video();
  expect(state.src).not.toContain(site.origin);
  expect(state.src).not.toContain(site.cdnOrigin);
  if (options.seek) {
    await expect.poll(async () => (await video()).duration, { timeout: 10_000 }).toBeGreaterThan(5);
    const target = Math.floor((await video()).duration / 2);
    await page.locator('video').evaluate((v: HTMLVideoElement, t) => {
      v.currentTime = t;
    }, target);
    await expect.poll(async () => (await video()).time, { timeout: 15_000 }).toBeGreaterThan(target + 0.5);
  }
  await page.keyboard.press('Escape');
  expect(site.log).toHaveLength(requests);
}

/** Browse cannot reach the site, but the library, history and downloads pages keep working. */
async function checkOfflineApp(): Promise<void> {
  await go('#/browse/sources/example%2Fen');
  await expect(page.getByRole('alert')).toContainText('Could not reach the site', { timeout: 20_000 });
  await go('#/library');
  await expect(page.getByRole('link', { name: 'Sky Harbor', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Quiet Orchard', exact: true })).toBeVisible();
  await go('#/history');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('History');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await go('#/downloads');
  await page.getByRole('button', { name: /^Completed/ }).click();
  await expect(page.locator('li[data-status="done"]').first()).toBeVisible();
}

let sky: Awaited<ReturnType<typeof series>>;
let orchard: Awaited<ReturnType<typeof series>>;
let categoryId: number;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  site = await TestSite.start({ mediaDir: resolve(__dirname, 'fixtures/media') });
  execFileSync(process.execPath, [resolve(ROOT, 'packages/extension-cli/dist/cli.js'), 'build', EXAMPLE], {
    stdio: 'pipe',
  });
  folder = mkdtempSync(join(tmpdir(), 'matane-phase3-'));
  ({ app, page, userData } = await launchApp());
  await page.waitForSelector('nav', { timeout: 30_000 });
  await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    window?.unmaximize();
    window?.setContentSize(1440, 900);
  });
  await invoke('extensions.loadDevFolder', { folder: EXAMPLE });
  await invoke('extensions.setPreference', { extensionId: 'example', key: 'baseUrl', value: site.origin });
});
test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  await site?.close();
  rmSync(folder, { recursive: true, force: true });
});

test('adds two anime to a category marked for auto-download, and the settings persist', async () => {
  // Every unwatched episode counts as "not new", so the "too many unwatched" rule would skip Sky Harbor.
  await invoke('settings.set', {
    downloadFolder: folder,
    autoDownload: true,
    updateSkipUnwatchedOver: null,
    downloadParallelSegments: 6,
  });
  sky = await series('Sky Harbor');
  orchard = await series('Quiet Orchard');
  categoryId = (await invoke<{ id: number }>('categories.create', { name: 'Watching' })).id;
  await invoke('categories.setAutoDownload', { id: categoryId, mode: 'include' });
  await invoke('library.add', { animeId: sky.animeId, categoryIds: [categoryId] });
  await invoke('library.add', { animeId: orchard.animeId, categoryIds: [categoryId] });

  await go('#/library');
  await expect(page.getByRole('tab', { name: /^Watching\s*2/ })).toBeVisible();

  // The Library settings page shows what main stored, also after a reload.
  await go('#/settings/library');
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Download new episodes automatically' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Watching', exact: true })).toHaveAttribute('aria-checked', 'true');
  expect(await invoke('settings.get')).toMatchObject({
    downloadFolder: folder,
    autoDownload: true,
    updateSkipUnwatchedOver: null,
    downloadParallelEpisodes: 1,
    downloadParallelSegments: 6,
  });
  const categories = await invoke<{ name: string; autoDownload: string | null }[]>('categories.list');
  expect(categories.map((c) => [c.name, c.autoDownload])).toEqual([['Watching', 'include']]);
});

test('downloads an HLS and an MP4 episode from their anime pages; both end up in Completed', async () => {
  for (const anime of [sky, orchard]) {
    await go(`#/anime/${anime.animeId}`);
    const row = page.getByRole('listitem').filter({ hasText: /Episode 1(?!\d)/ });
    await row.getByRole('button', { name: 'Download episode' }).click();
    await expect(page.getByText('Queued 1 episode')).toBeVisible();
    await expect.poll(async () => (await rowOf(anime.episodes[1]!))?.status, { timeout: 60_000 }).toBe('done');
    await expect(row).toContainText('Downloaded');
  }
  expect(await rowOf(sky.episodes[1]!)).toMatchObject({ kind: 'hls', status: 'done' });
  expect(await rowOf(orchard.episodes[1]!)).toMatchObject({ kind: 'mp4', status: 'done' });

  await go('#/downloads');
  await page.getByRole('button', { name: 'Completed (2)' }).click();
  const done = page.locator('li[data-status="done"]');
  await expect(done).toHaveCount(2);
  await expect(done.filter({ hasText: 'Sky Harbor' })).toBeVisible();
  await expect(done.filter({ hasText: 'Quiet Orchard' })).toBeVisible();
});

test('with the site down, both episodes play from disk, and Browse is the only page that notices', async () => {
  await site.stop();
  await playOffline(sky.episodes[1]!);
  await playOffline(orchard.episodes[1]!, { seek: true });
  await checkOfflineApp();
});

test('after restarting the app with the site still down, the downloads still play', async () => {
  await app.close();
  ({ app, page } = await launchApp({}, { userData }));
  await ready();
  await playOffline(sky.episodes[1]!);
  await playOffline(orchard.episodes[1]!, { seek: true });
  await checkOfflineApp();
  expect(await rowOf(sky.episodes[1]!)).toMatchObject({ status: 'done', error: null });
});

test('with the site back, a check finds the new episode and auto-download fetches it', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    window?.unmaximize();
    window?.setContentSize(1440, 900);
  });
  await site.resume();
  site.setEpisodeCount('sky-harbor', 13);

  await go('#/updates');
  await expect(page.getByRole('heading', { name: 'No new episodes' })).toBeVisible();
  const button = page.getByRole('button', { name: 'Check now' });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toBeEnabled({ timeout: 30_000 });

  await expect(page.getByRole('heading', { level: 2, name: 'Today' })).toBeVisible();
  await expect(updateRows()).toHaveCount(1);
  await expect(updateRows().first()).toContainText('Sky Harbor');
  await expect(updateRows().first()).toContainText('Episode 13');
  await expect(sidebarUpdates()).toContainText('1');

  // Nobody clicked Download: the episode is fetched because its category is included and the setting is on.
  const fresh = (await invoke<{ id: number; number: number }[]>('episodes.list', { animeId: sky.animeId })).find(
    (episode) => episode.number === 13,
  );
  expect(fresh).toBeDefined();
  await expect.poll(async () => (await rowOf(fresh!.id))?.status, { timeout: 60_000 }).toBe('done');
  await expect(updateRows().first().getByRole('link', { name: /^Play/ })).toBeVisible();
  await expect(updateRows().first()).toContainText('Downloaded');
  await shot('updates');

  // The notification click goes through the same navigation.
  await go('#/library');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('app.navigate', { to: '/updates' });
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Updates' })).toBeVisible();
  sky.episodes[13] = fresh!.id;
});

test('ends with three finished downloads, consistent storage, and the new episode leaves Updates once watched', async () => {
  await go('#/downloads');
  await page.getByRole('button', { name: 'Completed (3)' }).click();
  const done = page.locator('li[data-status="done"]');
  await expect(done).toHaveCount(3);
  await expect(done.filter({ hasText: 'Sky Harbor' })).toHaveCount(2);
  await expect(done.filter({ hasText: 'Quiet Orchard' })).toHaveCount(1);
  await expect(page.getByRole('progressbar', { name: 'Storage used by downloads' })).toBeVisible();
  await shot('downloads');

  const items = await downloads();
  expect(items.filter((item) => item.status === 'done')).toHaveLength(3);
  const storage = await invoke<{ folder: string; usedBytes: number; counts: Record<string, number> }>(
    'downloads.storage',
  );
  expect(storage.folder).toBe(folder);
  expect(storage.counts).toMatchObject({ done: 3, downloading: 0, queued: 0, paused: 0, error: 0 });
  const onDisk = files(folder)
    .filter((path) => !path.endsWith('.json'))
    .reduce((sum, path) => sum + statSync(path).size, 0);
  const counted = items.reduce((sum, item) => sum + item.bytesDone, 0);
  expect(storage.usedBytes).toBeGreaterThan(0);
  expect(storage.usedBytes).toBe(counted);
  expect(Math.abs(onDisk - storage.usedBytes)).toBeLessThan(Math.max(4096, storage.usedBytes * 0.05));

  await go('#/updates');
  await expect(updateRows()).toHaveCount(1);
  await updateRows()
    .first()
    .getByRole('button', { name: /as watched/ })
    .click();
  await expect(page.getByRole('heading', { name: 'No new episodes' })).toBeVisible();
  await expect(sidebarUpdates()).not.toContainText(/\d/);
  expect(await invoke('updates.count')).toBe(0);
  // Watched, it still sits in Downloads: only "delete after watching" would remove it, and that is off.
  expect(await rowOf(sky.episodes[13]!)).toMatchObject({ status: 'done' });
});
