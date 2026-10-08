import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 3, milestone 3d: the Downloads page, the entry points on the anime page, the shell indicators and
// the Downloads and Data settings, driven through the real app, extension and test site.

const ROOT = resolve(__dirname, '../../..');
const EXAMPLE = resolve(ROOT, 'extensions/example');
const SHOTS = resolve(__dirname, '../test-results/screens');

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
const shot = (name: string) => page.screenshot({ path: resolve(SHOTS, `downloads-ui-${name}.png`) });
/** Both flavors of the screen as it is now, for comparing with the mockups. */
async function shots(name: string): Promise<void> {
  await invoke('settings.set', { theme: 'mocha' });
  await page.waitForTimeout(200);
  await shot(`${name}-mocha`);
  await invoke('settings.set', { theme: 'latte' });
  await page.waitForTimeout(200);
  await shot(`${name}-latte`);
  await invoke('settings.set', { theme: 'mocha' });
}

interface Item {
  id: number;
  episodeId: number;
  status: string;
  queueOrder: number;
  error: string | null;
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

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
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

let longWave: Awaited<ReturnType<typeof series>>;
const downloadsLink = () => page.locator('aside').getByRole('link', { name: /Downloads/ });

test('starts a download from an episode row and follows it to the end (DL-1, DL-8, BRW-5)', async () => {
  longWave = await series('Long Wave');
  site.setThrottle({ segmentDelayMs: 1000 });
  await go(`#/anime/${longWave.animeId}`);
  const row = page.getByRole('listitem').filter({ hasText: 'Episode 1' });
  await row.getByRole('button', { name: 'Download episode' }).click();

  await expect(page.getByText('Queued 1 episode')).toBeVisible();
  // The row, the sidebar and the title bar all show that something is running.
  await expect(row.getByRole('link', { name: /Download: Downloading/ })).toBeVisible();
  await expect(downloadsLink()).toContainText('1 download running or waiting');
  await expect(page.getByRole('banner').getByRole('link', { name: /Downloading 1/ })).toBeVisible();
  await shot('anime-downloading-mocha');

  await go('#/downloads');
  const active = page.locator('li[data-status="downloading"]');
  await expect(active).toContainText('Long Wave');
  await expect(active).toContainText(/\d+ \/ \d+ segments/);
  await expect(page.getByText('1 downloading')).toBeVisible();

  // Pause, then resume.
  await active.getByRole('button', { name: /^Pause / }).click();
  await expect(page.locator('li[data-status="paused"]')).toContainText('Paused');
  await expect(page.getByText('1 paused')).toBeVisible();
  await page.getByRole('button', { name: 'Resume all' }).click();
  await expect(page.locator('li[data-status="downloading"]')).toBeVisible();

  // It finishes: the row moves to the collapsed Completed section.
  const completed = page.getByRole('button', { name: 'Completed (1)' });
  await expect(completed).toBeVisible({ timeout: 45_000 });
  await completed.click();
  const done = page.locator('li[data-status="done"]');
  await expect(done).toContainText('Long Wave');
  await expect(done.getByRole('link', { name: /^Play / })).toBeVisible();
  await expect(downloadsLink()).not.toContainText('running or waiting');

  // The anime page marks it, and the filter keeps only downloaded episodes.
  await go(`#/anime/${longWave.animeId}`);
  await expect(page.getByRole('listitem').filter({ hasText: 'Episode 1' })).toContainText('Downloaded');
  await page.getByRole('button', { name: 'Downloaded', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Downloaded', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(3);
  site.setThrottle({});
});

test('says why a download failed, and Retry finishes it (DL-7)', async () => {
  site.addFault({ pattern: 'seg_001.ts', status: 403 });
  await go(`#/anime/${longWave.animeId}`);
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Episode 2' })
    .getByRole('button', { name: 'Download episode' })
    .click();
  await go('#/downloads');
  const failed = page.locator('li[data-status="error"]');
  await expect(failed).toContainText(/refused the request \(403\)|link expired/, { timeout: 45_000 });
  await expect(failed).toContainText('Failed');
  await shot('failed-mocha');

  site.clearFaults();
  await failed.getByRole('button', { name: /^Retry / }).click();
  await expect(page.getByRole('button', { name: 'Completed (2)' })).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('li[data-status="error"]')).toHaveCount(0);
});

test('shows every state on one page, reorders the queue and clears failed ones', async () => {
  const farShore = await series('Far Shore');
  const cipher = await series('Cipher Coast');
  // A failure to keep: Far Shore's first segments are refused.
  site.addFault({ pattern: 'seg_001.ts', status: 403 });
  await invoke('downloads.enqueue', { episodeIds: [farShore.episodes[1]] });
  await expect.poll(() => statusOf(farShore.episodes[1]!), { timeout: 45_000 }).toBe('error');
  site.clearFaults();

  // One running, two waiting, one paused.
  site.setThrottle({ segmentDelayMs: 1500 });
  await invoke('downloads.enqueue', { episodeIds: [longWave.episodes[3]] });
  await expect.poll(() => statusOf(longWave.episodes[3]!)).toBe('downloading');
  await invoke('downloads.enqueue', { episodeIds: [cipher.episodes[1]] });
  await invoke('downloads.enqueue', { episodeIds: [cipher.episodes[2]] });
  await invoke('downloads.enqueue', { episodeIds: [cipher.episodes[3]] });
  const third = (await list()).find((item) => item.episodeId === cipher.episodes[3])!;
  await invoke('downloads.pause', { id: third.id });

  await go('#/downloads');
  await expect(page.locator('li[data-status="downloading"]')).toHaveCount(1);
  await expect(page.locator('li[data-status="queued"]')).toHaveCount(2);
  await expect(page.locator('li[data-status="paused"]')).toHaveCount(1);
  await expect(page.locator('li[data-status="error"]')).toHaveCount(1);
  await expect(page.locator('li[data-status="queued"]').first()).toContainText('Waiting for a free slot');
  await expect(page.getByText('1 downloading · 2 queued · 1 paused · 1 failed')).toBeVisible();
  await expect(downloadsLink()).toContainText('3 downloads running or waiting');
  await page.getByRole('button', { name: /^Completed/ }).click();
  await expect(page.getByRole('progressbar', { name: 'Storage used by downloads' })).toBeVisible();
  await shots('downloads');

  // Drag the second waiting episode above the first.
  const queued = page.locator('li[data-status="queued"]');
  await expect(queued.first()).toContainText('Episode 1');
  await queued
    .nth(1)
    .getByRole('button', { name: /in the queue/ })
    .dragTo(queued.first());
  await expect(queued.first()).toContainText('Episode 2');
  await expect
    .poll(async () => (await list()).filter((i) => i.status === 'queued').map((i) => i.episodeId))
    .toEqual([cipher.episodes[2], cipher.episodes[1]]);
  // And back with the keyboard.
  const handle = queued.nth(1).getByRole('button', { name: /in the queue/ });
  await handle.focus();
  await handle.press('ArrowUp');
  await expect(queued.first()).toContainText('Episode 1');

  // "Clear failed" drops only the failed one.
  await page.getByRole('button', { name: 'Clear failed' }).click();
  await expect(page.locator('li[data-status="error"]')).toHaveCount(0);
  await expect(page.locator('li[data-status="queued"]')).toHaveCount(2);

  // Cancelling the running one hands its slot on.
  await page
    .locator('li[data-status="downloading"]')
    .getByRole('button', { name: /^Cancel / })
    .click();
  await expect(page.locator('li[data-status="downloading"]')).toContainText('Cipher Coast');
  await invoke('downloads.pauseAll');
  site.setThrottle({});
});

test('Settings → Downloads saves each control, and changing the folder can move the episodes (DL-6, DL-9…13)', async () => {
  await go('#/settings/downloads');
  await expect(page.getByRole('heading', { name: 'Downloads', level: 1 })).toBeVisible();
  await page.getByLabel('Quality', { exact: true }).selectOption('720');
  await page.getByLabel('Episodes at once').selectOption('2');
  await page.getByLabel('Segments per episode').selectOption('8');
  await page.getByRole('switch', { name: 'Download ahead while watching' }).click();
  await page.getByLabel('Episodes to download ahead').selectOption('3');
  await page.getByRole('switch', { name: 'Delete after watching' }).click();
  await page.getByLabel('When to delete').selectOption('2');
  const limit = page.getByRole('spinbutton', { name: 'Size limit' });
  await limit.fill('25');
  await limit.press('Enter');

  const expected = {
    downloadQuality: '720',
    downloadParallelEpisodes: 2,
    downloadParallelSegments: 8,
    downloadAhead: true,
    downloadAheadCount: 3,
    deleteAfterWatched: true,
    deleteAfterWatchedDelay: 2,
    downloadSizeLimitGb: 25,
  };
  await expect.poll(() => invoke('settings.get')).toMatchObject(expected);
  await page.reload();
  await page.waitForSelector('nav');
  await expect(page.getByLabel('Quality', { exact: true })).toHaveValue('720');
  await expect(page.getByLabel('Episodes at once')).toHaveValue('2');
  await expect(page.getByRole('switch', { name: 'Delete after watching' })).toBeChecked();
  await expect(page.getByRole('spinbutton', { name: 'Size limit' })).toHaveValue('25');
  await expect(page.getByText(/GB used|MB used|KB used|\d B used/)).toBeVisible();
  await shots('settings-downloads');

  // The folder: pick one (the native dialog is stubbed), say "move them", and the files follow.
  const target = mkdtempSync(join(tmpdir(), 'matane-dl-ui-'));
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
  }, target);
  await page.getByRole('button', { name: 'Change folder' }).click();
  await expect(page.getByRole('dialog', { name: 'Move the episodes already downloaded?' })).toBeVisible();
  await page.getByRole('button', { name: 'Move them' }).click();
  await expect(page.getByText('Download folder changed')).toBeVisible();
  await expect(page.getByText(target, { exact: true })).toBeVisible();
  expect(existsSync(target) && readdirSync(target).length > 0).toBe(true);
  const storage = await invoke<{ folder: string }>('downloads.storage');
  expect(storage.folder).toBe(target);
  // They still play from the new place: nothing is flagged as missing.
  expect((await list()).filter((item) => item.error === 'file_missing')).toHaveLength(0);
});

test('Settings → Data shows the storage of the downloaded episodes (DL-9)', async () => {
  await go('#/settings/data');
  await expect(page.getByRole('heading', { name: 'Data and storage', level: 1 })).toBeVisible();
  await expect(page.getByText('Downloaded episodes')).toBeVisible();
  await expect(page.getByText(/% of the 25 GB limit/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open folder' })).toBeEnabled();
  await shots('settings-data');
});

test('asks before passing the size limit, then downloads anyway (DL-10)', async () => {
  const { episodes, animeId } = await series('Turning Keys');
  // The fixtures are far smaller than any limit the settings allow, so main's answer is staged.
  await app.evaluate(({ ipcMain }) => {
    const calls: unknown[] = [];
    (globalThis as { __enqueue?: unknown[] }).__enqueue = calls;
    ipcMain.removeHandler('downloads.enqueue');
    ipcMain.handle('downloads.enqueue', (_event, input: { episodeIds: number[]; force?: boolean }) => {
      calls.push(input);
      return input.force
        ? { queued: input.episodeIds, existing: [], refused: [] }
        : {
            queued: [],
            existing: [],
            refused: input.episodeIds.map((episodeId) => ({ episodeId, reason: 'size_limit' })),
          };
    });
  });
  await go(`#/anime/${animeId}`);
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('menuitem', { name: /All episodes/ }).click();

  const dialog = page.getByRole('dialog', { name: 'This passes your size limit' });
  await expect(dialog).toContainText('3 more episodes would go past your 25 GB limit');
  await shot('size-limit-mocha');
  await dialog.getByRole('button', { name: 'Download anyway' }).click();
  await expect(page.getByText('Queued 3 episodes')).toBeVisible();

  const calls = (await app.evaluate(() => (globalThis as { __enqueue?: unknown[] }).__enqueue)) as {
    episodeIds: number[];
    force?: boolean;
  }[];
  expect(calls).toHaveLength(2);
  expect(calls[0]!.force).toBeUndefined();
  expect(calls[1]!.force).toBe(true);
  expect(new Set(calls[1]!.episodeIds)).toEqual(new Set(Object.values(episodes)));

  // Saying no queues nothing.
  await go(`#/anime/${animeId}`);
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('menuitem', { name: /All episodes/ }).click();
  await page
    .getByRole('dialog', { name: 'This passes your size limit' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await app.evaluate(() => (globalThis as { __enqueue?: unknown[] }).__enqueue?.length)).toBe(3);
});
