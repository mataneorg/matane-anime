import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 2, milestone 2c: the history, and searching every source at once.

const ROOT = resolve(__dirname, '../../..');
const EXAMPLE = resolve(ROOT, 'extensions/example');
const PROBE = resolve(__dirname, 'fixtures/extensions/probe');
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
const setProbe = (url: string) => invoke('extensions.setPreference', { extensionId: 'probe', key: 'url', value: url });

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
  await invoke('extensions.loadDevFolder', { folder: PROBE });
  await invoke('extensions.setPreference', { extensionId: 'example', key: 'baseUrl', value: site.origin });
});
test.afterAll(async () => {
  await app?.close();
  await site?.close();
});

test.describe('global search (BRW-2)', () => {
  test('asks every source, shows each as it answers, and says which one failed', async () => {
    await setProbe(`${site.origin}/_t/status?code=500`);
    // The title bar button opens the command palette; Tab on a typed query searches every source.
    await page.getByRole('button', { name: /Search library, sources, episodes/ }).click();
    await page.getByRole('combobox', { name: 'Search the app' }).fill('sky');
    await page.getByRole('combobox', { name: 'Search the app' }).press('Tab');
    await expect(page).toHaveURL(/browse\/global-search/);
    await expect(page.getByRole('searchbox', { name: 'Search every source' })).toHaveValue('sky');

    await expect(page.getByRole('status').filter({ hasText: '3 of 3 sources done' })).toBeVisible({ timeout: 20_000 });
    const english = page.getByRole('listitem').filter({ hasText: 'Example Site (EN)' });
    await expect(english).toContainText('1 result');
    await expect(english.getByRole('link', { name: 'Sky Harbor' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Example Site (ID)' })).toContainText('1 result');
    const failed = page.getByRole('listitem').filter({ hasText: 'Probe' });
    await expect(failed).toContainText('The site answered with an error (500)');
    await shot('global-search');

    // The failing source is asked again on its own, and now answers.
    await setProbe(`${site.origin}/_t/status?code=200`);
    await failed.getByRole('button', { name: 'Try again' }).click();
    await expect(failed).toContainText('1 result');
  });

  test('says when a source has nothing, and opens a result or the whole source', async () => {
    await page.getByRole('searchbox', { name: 'Search every source' }).fill('zzzz');
    await page.getByRole('searchbox', { name: 'Search every source' }).press('Enter');
    await expect(page.getByText('No results for "zzzz".').first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole('searchbox', { name: 'Search every source' }).fill('sky');
    await page.getByRole('searchbox', { name: 'Search every source' }).press('Enter');
    const english = page.getByRole('listitem').filter({ hasText: 'Example Site (EN)' });
    await english.getByRole('link', { name: 'View all' }).click();
    await expect(page).toHaveURL(/browse\/sources\/example%2Fen/);
    await expect(page.getByRole('searchbox', { name: 'Search this source' })).toHaveValue('sky');
    await expect(page.getByText('Sky Harbor')).toBeVisible();

    await page.goBack();
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Example Site (EN)' })
      .getByRole('link', { name: 'Sky Harbor' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sky Harbor' })).toBeVisible();
  });

  test('stops asking a source that no longer matches the language chosen', async () => {
    await go('#/browse/global-search');
    await page.getByLabel('Sources').selectOption('id');
    await page.getByRole('searchbox', { name: 'Search every source' }).fill('sky');
    await page.getByRole('searchbox', { name: 'Search every source' }).press('Enter');
    await expect(page.getByRole('status').filter({ hasText: '1 of 1 sources done' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('listitem').filter({ hasText: 'Example Site (EN)' })).toHaveCount(0);
  });
});

test.describe('history (PRG-8)', () => {
  test('starts empty', async () => {
    await go('#/history');
    await expect(page.getByRole('heading', { name: 'Nothing watched yet' })).toBeVisible();
  });

  test('lists one entry per anime, newest first, with what to play next', async () => {
    const night = await episodeOf('Long Night', 1);
    await watch(night.id, 20_000, 40_000);
    const orchard = await episodeOf('Quiet Orchard', 1);
    await watch(orchard.id, 5400, 6000); // past the 85% threshold of a 6 s video

    await go('#/history');
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    const rows = page.getByRole('listitem');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Quiet Orchard');
    await expect(rows.first()).toContainText('Watched');
    await expect(rows.first().getByRole('link', { name: 'Play Ep 2' })).toBeVisible();
    await expect(rows.nth(1)).toContainText('Long Night');
    await expect(rows.nth(1)).toContainText('0:20 of 0:40');
    await expect(rows.nth(1).getByRole('link', { name: 'Continue' })).toBeVisible();
    await shot('history');

    // Watching the same anime again moves its single entry, it does not add a second one.
    await watch(night.id, 25_000, 40_000);
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Long Night');
    await expect(rows.first()).toContainText('0:25 of 0:40');
  });

  test('removes an entry, and clearing everything keeps the library and progress', async () => {
    const night = await episodeOf('Long Night', 1);
    await invoke('library.add', { animeId: night.animeId, categoryIds: [] });
    await page.getByRole('button', { name: /Remove Quiet Orchard from history/ }).click();
    await expect(page.getByRole('listitem')).toHaveCount(1);

    await page.getByRole('button', { name: 'Clear all history' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Clear all history' }).click();
    await expect(page.getByRole('heading', { name: 'Nothing watched yet' })).toBeVisible();

    const library = await invoke<{ title: string; continue: { resumeMs: number } | null }[]>('library.list', {
      sort: 'title',
    });
    expect(library[0]).toMatchObject({ title: 'Long Night', continue: { resumeMs: 22_000 } });
  });
});
