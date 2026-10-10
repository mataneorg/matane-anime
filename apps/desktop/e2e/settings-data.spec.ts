import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Settings, "Data and storage" and "About": clearing the history from Settings, and the update channel.

const ROOT = resolve(__dirname, '../../..');
const EXAMPLE = resolve(ROOT, 'extensions/example');
const SHOTS = resolve(__dirname, '../test-results/screens');

test.describe.configure({ mode: 'serial' });

let site: TestSite;
let app: ElectronApplication;
let page: Page;
let userData: string;

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
const shot = (name: string) => page.screenshot({ path: resolve(SHOTS, `${name}.png`) });

async function episodeOf(title: string, number: number): Promise<{ id: number; animeId: number }> {
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
  return { id: episodes.find((e) => e.number === number)!.id, animeId: anime.animeId };
}
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
  mkdirSync(SHOTS, { recursive: true });
  site = await TestSite.start({ mediaDir: resolve(__dirname, 'fixtures/media') });
  execFileSync(process.execPath, [resolve(ROOT, 'packages/extension-cli/dist/cli.js'), 'build', EXAMPLE], {
    stdio: 'pipe',
  });
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
});

test.describe('clear history (PRG-10)', () => {
  let watchMs = 0;

  test('has a history, a library entry with progress, and watch time to keep', async () => {
    const night = await episodeOf('Long Night', 1);
    await invoke('library.add', { animeId: night.animeId, categoryIds: [] });
    await watch(night.id, 20_000, 40_000);

    expect(await invoke<unknown[]>('history.list')).toHaveLength(1);
    const stats = await invoke<{ hasData: boolean; watchMs: number }>('stats.overview', { range: 'all' });
    expect(stats.hasData).toBe(true);
    expect(stats.watchMs).toBeGreaterThan(0);
    watchMs = stats.watchMs;
  });

  test('Clear history in Settings empties the history and nothing else', async () => {
    await go('#/settings/data');
    await page.getByTestId('clear-history').click();
    await shot('settings-clear-history-confirm');
    await page.getByRole('dialog').getByRole('button', { name: 'Clear all history' }).click();
    await expect.poll(() => invoke<unknown[]>('history.list')).toHaveLength(0);

    await go('#/history');
    await expect(page.getByRole('heading', { name: 'Nothing watched yet' })).toBeVisible();

    // The library and its progress stay.
    const library = await invoke<{ title: string; continue: { resumeMs: number } | null }[]>('library.list', {
      sort: 'title',
    });
    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({ title: 'Long Night', continue: { resumeMs: 17_000 } });
    // So do the watch sessions behind the statistics.
    const stats = await invoke<{ hasData: boolean; watchMs: number }>('stats.overview', { range: 'all' });
    expect(stats).toMatchObject({ hasData: true, watchMs });
  });

  test('cancelling the dialog keeps the history', async () => {
    const night = await episodeOf('Long Night', 1);
    await watch(night.id, 25_000, 40_000);
    expect(await invoke<unknown[]>('history.list')).toHaveLength(1);

    await go('#/settings/data');
    await page.getByTestId('clear-history').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await invoke<unknown[]>('history.list')).toHaveLength(1);
  });

  test('Clear watch time forgets the statistics and keeps the history and the library', async () => {
    await page.getByRole('button', { name: 'Clear watch time' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Clear watch time' }).click();
    await expect
      .poll(async () => (await invoke<{ hasData: boolean }>('stats.overview', { range: 'all' })).hasData)
      .toBe(false);
    expect(await invoke<unknown[]>('history.list')).toHaveLength(1);
    expect(await invoke<unknown[]>('library.list', { sort: 'title' })).toHaveLength(1);
  });
});

test.describe('update channel', () => {
  const channel = () => page.getByLabel('Update channel');

  test('starts on the default channel and changes it from About', async () => {
    expect((await invoke<{ updateChannel: string }>('settings.get')).updateChannel).toBe('beta');
    await go('#/settings/about');
    await expect(channel()).toHaveValue('beta');
    await channel().selectOption('stable');
    await expect
      .poll(async () => (await invoke<{ updateChannel: string }>('settings.get')).updateChannel)
      .toBe('stable');
    await shot('settings-update-channel');
  });

  test('the choice survives an app restart', async () => {
    await app.close();
    ({ app, page } = await launchApp({}, { userData }));
    await page.waitForSelector('nav', { timeout: 30_000 });
    expect((await invoke<{ updateChannel: string }>('settings.get')).updateChannel).toBe('stable');
    await go('#/settings/about');
    await expect(channel()).toHaveValue('stable');

    await channel().selectOption('beta');
    await expect.poll(async () => (await invoke<{ updateChannel: string }>('settings.get')).updateChannel).toBe('beta');
  });
});
