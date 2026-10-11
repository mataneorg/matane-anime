import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Locator, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Right-click menus on the rows of the Downloads, Updates and History pages, driven through the real app,
// extension and test site.

const ROOT = resolve(__dirname, '../../..');
const EXAMPLE = resolve(ROOT, 'extensions/example');

test.describe.configure({ mode: 'serial' });

let site: TestSite;
let app: ElectronApplication;
let page: Page;

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

interface Item {
  id: number;
  episodeId: number;
  status: string;
}
const list = () => invoke<Item[]>('downloads.list');
const statusOf = async (episodeId: number) => (await list()).find((item) => item.episodeId === episodeId)?.status;

/** Finds a (hidden) series of the test site through search and loads its episodes. */
async function series(title: string): Promise<{ animeId: number; episodes: Record<number, number> }> {
  const found = await invoke<{ items: { animeId: number; title: string }[] }>('sources.browse', {
    sourceId: 'example/en',
    kind: 'search',
    page: 1,
    query: title,
  });
  const anime = found.items.find((item) => item.title === title)!;
  const { episodes } = await invoke<{ episodes: { id: number; number: number }[] }>('anime.refresh', {
    animeId: anime.animeId,
  });
  return { animeId: anime.animeId, episodes: Object.fromEntries(episodes.map((e) => [e.number, e.id])) };
}

/** Right-clicks the row and returns the open menu. */
async function menuOf(row: Locator): Promise<Locator> {
  await row.click({ button: 'right', position: { x: 12, y: 8 } });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}
const itemNames = (menu: Locator) => menu.getByRole('menuitem').allTextContents();

/** Real playing time is needed before an anime enters the history: five seconds of it. */
async function watch(episodeId: number, positionMs: number, durationMs: number): Promise<void> {
  const send = (reason: string, position: number) =>
    invoke('watch.progress', { playbackId: `e2e-${episodeId}`, episodeId, positionMs: position, durationMs, reason });
  await send('play', 0);
  await page.waitForTimeout(5300);
  await send('heartbeat', positionMs);
  await send('close', positionMs);
}

test.beforeAll(async () => {
  site = await TestSite.start({ mediaDir: resolve(__dirname, 'fixtures/media') });
  execFileSync(process.execPath, [resolve(ROOT, 'packages/extension-cli/dist/cli.js'), 'build', EXAMPLE], {
    stdio: 'pipe',
  });
  ({ app, page } = await launchApp());
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
  await app?.close();
  await site?.close();
});

test('download rows offer what their status allows, and the entries act on the download', async () => {
  const longWave = await series('Long Wave');
  const cipher = await series('Cipher Coast');
  // A slow site keeps one download running and the other two waiting for a slot.
  site.setThrottle({ segmentDelayMs: 1500 });
  await invoke('downloads.enqueue', { episodeIds: [longWave.episodes[1]] });
  await expect.poll(() => statusOf(longWave.episodes[1]!)).toBe('downloading');
  await invoke('downloads.enqueue', { episodeIds: [cipher.episodes[1]] });
  await invoke('downloads.enqueue', { episodeIds: [cipher.episodes[2]] });
  await go('#/downloads');

  // Queued: only the second one can move up, and the queue follows.
  const queued = page.locator('li[data-status="queued"]');
  await expect(queued).toHaveCount(2);
  await expect(queued.first()).toContainText('Episode 1');
  let menu = await menuOf(queued.first());
  await expect(menu.getByRole('menuitem', { name: 'Move up the queue' })).toHaveAttribute('data-disabled', '');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  menu = await menuOf(queued.nth(1));
  await expect(menu.getByRole('menuitem', { name: 'Move up the queue' })).not.toHaveAttribute('data-disabled', '');
  await menu.getByRole('menuitem', { name: 'Move up the queue' }).click();
  await expect(queued.first()).toContainText('Episode 2');
  await expect
    .poll(async () => (await list()).filter((item) => item.status === 'queued').map((item) => item.episodeId))
    .toEqual([cipher.episodes[2], cipher.episodes[1]]);

  // Open anime page goes to the anime.
  menu = await menuOf(queued.first());
  await menu.getByRole('menuitem', { name: 'Open anime page' }).click();
  await expect(page).toHaveURL(new RegExp(`#/anime/${cipher.animeId}$`));

  // Open downloads folder asks main to open the root folder (the real file manager is stubbed out).
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { __opened?: string[] }).__opened = opened;
    shell.openPath = async (path: string) => {
      opened.push(path);
      return '';
    };
  });
  await go('#/downloads');
  menu = await menuOf(page.locator('li[data-status="downloading"]'));
  await menu.getByRole('menuitem', { name: 'Open downloads folder' }).click();
  const storage = await invoke<{ folder: string }>('downloads.storage');
  await expect
    .poll(() => app.evaluate(() => (globalThis as { __opened?: string[] }).__opened))
    .toEqual([storage.folder]);

  // Running: Pause and Cancel, and Pause pauses it.
  const running = page.locator('li[data-status="downloading"]');
  await expect(running).toHaveCount(1);
  menu = await menuOf(running);
  expect(await itemNames(menu)).toEqual(['Pause', 'Open anime page', 'Open downloads folder', 'Cancel download']);
  await menu.getByRole('menuitem', { name: 'Pause', exact: true }).click();
  await expect(page.locator('li[data-status="paused"]')).toHaveCount(1);

  // Paused: Resume, and Resume sets it running again.
  menu = await menuOf(page.locator('li[data-status="paused"]'));
  expect(await itemNames(menu)).toEqual(['Resume', 'Open anime page', 'Open downloads folder', 'Cancel download']);
  await menu.getByRole('menuitem', { name: 'Resume', exact: true }).click();
  await expect(page.locator('li[data-status="paused"]')).toHaveCount(0);
  expect(['queued', 'downloading']).toContain(await statusOf(longWave.episodes[1]!));

  // Cancel: the running download goes.
  const current = (await list()).find((item) => item.status === 'downloading')!;
  menu = await menuOf(page.locator('li[data-status="downloading"]'));
  await menu.getByRole('menuitem', { name: 'Cancel download' }).click();
  await expect.poll(() => statusOf(current.episodeId)).toBeUndefined();

  await invoke('downloads.pauseAll');
  site.setThrottle({});
});

test('failed and finished downloads: retry, remove from the list, play, and delete asks first', async () => {
  const farShore = await series('Far Shore');
  const turning = await series('Turning Keys');
  for (const item of await list()) await invoke('downloads.cancel', { id: item.id });

  // A failure: the first segment is refused.
  site.addFault({ pattern: 'seg_001.ts', status: 403 });
  await invoke('downloads.enqueue', { episodeIds: [farShore.episodes[1]] });
  await expect.poll(() => statusOf(farShore.episodes[1]!), { timeout: 45_000 }).toBe('error');
  await go('#/downloads');
  const failed = page.locator('li[data-status="error"]');
  let menu = await menuOf(failed);
  expect(await itemNames(menu)).toEqual(['Retry', 'Open anime page', 'Open downloads folder', 'Remove from list']);

  // Retry with the site back finishes it.
  site.clearFaults();
  await menu.getByRole('menuitem', { name: 'Retry', exact: true }).click();
  await expect.poll(() => statusOf(farShore.episodes[1]!), { timeout: 45_000 }).toBe('done');

  // Remove from list drops a failed download.
  site.addFault({ pattern: 'seg_001.ts', status: 403 });
  await invoke('downloads.enqueue', { episodeIds: [turning.episodes[1]] });
  await expect.poll(() => statusOf(turning.episodes[1]!), { timeout: 45_000 }).toBe('error');
  menu = await menuOf(failed);
  await menu.getByRole('menuitem', { name: 'Remove from list' }).click();
  await expect.poll(() => statusOf(turning.episodes[1]!)).toBeUndefined();
  site.clearFaults();

  // Finished: Play and Delete file, which asks before it deletes.
  await page.getByRole('tab', { name: /^Completed/ }).click();
  const done = page.locator('li[data-status="done"]');
  await expect(done).toHaveCount(1);
  menu = await menuOf(done);
  expect(await itemNames(menu)).toEqual(['Play', 'Open anime page', 'Open downloads folder', 'Delete file']);
  await menu.getByRole('menuitem', { name: 'Delete file' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this download?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(await statusOf(farShore.episodes[1]!)).toBe('done');

  menu = await menuOf(done);
  await menu.getByRole('menuitem', { name: 'Delete file' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => statusOf(farShore.episodes[1]!)).toBeUndefined();

  // Play opens the player for a finished one.
  await invoke('downloads.enqueue', { episodeIds: [farShore.episodes[2]] });
  await expect.poll(() => statusOf(farShore.episodes[2]!), { timeout: 45_000 }).toBe('done');
  await expect(done).toHaveCount(1);
  menu = await menuOf(done);
  await menu.getByRole('menuitem', { name: 'Play', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/watch/${farShore.episodes[2]}`));
});

test('update rows: mark as seen keeps the episode unwatched, download and watched work from the menu', async () => {
  const sky = (await series('Sky Harbor')).animeId;
  await invoke('library.add', { animeId: sky, categoryIds: [] });
  // By default a check skips anime that were not started.
  await invoke('settings.set', {
    updateSkipNotStarted: false,
    updateSkipCompleted: false,
    updateSkipUnwatchedOver: null,
  });
  await go('#/updates');
  site.setEpisodeCount('sky-harbor', 14);
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByRole('button', { name: 'Check now' })).toBeEnabled({ timeout: 30_000 });
  const rows = page
    .getByRole('list')
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: 'Play' }) });
  await expect(rows).toHaveCount(2);
  const unwatched = async () =>
    (await invoke<{ watched: boolean }[]>('episodes.list', { animeId: sky })).filter((e) => !e.watched).length;
  const before = await unwatched();

  let menu = await menuOf(rows.first());
  expect(await itemNames(menu)).toEqual(['Play', 'Download', 'Mark as watched', 'Open anime page', 'Mark as seen']);
  await menu.getByRole('menuitem', { name: 'Mark as seen' }).click();
  await expect(rows).toHaveCount(1);
  expect(await unwatched()).toBe(before);

  // Download queues it; the row then has no Download entry.
  menu = await menuOf(rows.first());
  await menu.getByRole('menuitem', { name: 'Download', exact: true }).click();
  await expect(rows.first()).toContainText(/Queued|Downloading|Downloaded/);
  menu = await menuOf(rows.first());
  expect(await itemNames(menu)).toEqual(['Play', 'Mark as watched', 'Open anime page', 'Mark as seen']);

  // Open anime page goes to the anime; Mark as watched takes the last entry off the list.
  await menu.getByRole('menuitem', { name: 'Open anime page' }).click();
  await expect(page).toHaveURL(new RegExp(`#/anime/${sky}$`));
  await go('#/updates');
  menu = await menuOf(rows.first());
  await menu.getByRole('menuitem', { name: 'Mark as watched' }).click();
  await expect(page.getByRole('heading', { name: 'No new episodes' })).toBeVisible();
  expect(await unwatched()).toBe(before - 1);
});

test('history rows: continue, open the anime and remove from history', async () => {
  const night = await series('Long Night');
  await watch(night.episodes[1]!, 20_000, 40_000);
  await go('#/history');
  const row = page.getByRole('listitem').filter({ hasText: 'Long Night' });
  await expect(row).toHaveCount(1);

  let menu = await menuOf(row);
  expect(await itemNames(menu)).toEqual(['Continue', 'Open anime page', 'Remove from history']);
  await menu.getByRole('menuitem', { name: 'Open anime page' }).click();
  await expect(page).toHaveURL(new RegExp(`#/anime/${night.animeId}$`));

  await go('#/history');
  menu = await menuOf(row);
  await menu.getByRole('menuitem', { name: 'Continue' }).click();
  await expect(page).toHaveURL(new RegExp(`#/watch/${night.episodes[1]}`));

  await go('#/history');
  menu = await menuOf(row);
  await menu.getByRole('menuitem', { name: 'Remove from history' }).click();
  await expect(page.getByRole('heading', { name: 'Nothing watched yet' })).toBeVisible();
  expect(await invoke<unknown[]>('history.list')).toHaveLength(0);
});
