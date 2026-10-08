import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 3, milestone 3f: the Updates page, its sidebar badge and the update settings as a user meets them.

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
const shot = (name: string) => page.screenshot({ path: resolve(SHOTS, `${name}.png`) });
/** The screen in both flavors, once the colors have finished transitioning. */
async function shots(name: string): Promise<void> {
  await shot(`${name}-mocha`);
  await invoke('settings.set', { theme: 'latte' });
  await page.waitForTimeout(500);
  await shot(`${name}-latte`);
  await invoke('settings.set', { theme: 'mocha' });
  await page.waitForTimeout(500);
}
const sidebarUpdates = () => page.locator('aside').getByRole('link', { name: /^Updates/ });
const rows = () =>
  page
    .getByRole('list')
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: 'Play' }) });

async function animeIdOf(title: string): Promise<number> {
  const found = await invoke<{ items: { animeId: number; title: string }[] }>('sources.browse', {
    sourceId: 'example/en',
    kind: 'search',
    page: 1,
    query: title,
  });
  const anime = found.items.find((item) => item.title === title);
  if (!anime) throw new Error(`No anime ${title}`);
  return anime.animeId;
}

async function checkNow(): Promise<void> {
  const button = page.getByRole('button', { name: 'Check now' });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toBeEnabled({ timeout: 30_000 });
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

test('the update settings persist: interval, skip rules, auto-download and its categories', async () => {
  await go('#/settings/library');
  await expect(page.getByRole('heading', { level: 2, name: 'New episode checks' })).toBeVisible();
  await expect(page.getByLabel('Check every')).toHaveValue('12');

  // Categories to mark.
  for (const name of ['Watching', 'Plan to watch', 'Completed']) {
    await page.getByLabel('New category').fill(name);
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByRole('checkbox', { name, exact: true })).toBeVisible();
  }

  await page.getByLabel('Check every').selectOption('24');
  await page.getByRole('checkbox', { name: 'Anime you have not started' }).click();
  await expect(page.getByRole('checkbox', { name: 'Anime you have not started' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Anime that are completed' }).click();
  await expect(page.getByRole('checkbox', { name: 'Anime that are completed' })).not.toBeChecked();
  await page.getByLabel('Number of unwatched episodes').fill('5');
  await page.getByLabel('Number of unwatched episodes').blur();
  await page.getByRole('switch', { name: 'Download new episodes automatically' }).click();
  const watching = page.getByRole('checkbox', { name: 'Watching', exact: true });
  const completed = page.getByRole('checkbox', { name: 'Completed', exact: true });
  const planned = page.getByRole('checkbox', { name: 'Plan to watch', exact: true });
  await expect(watching).toHaveAttribute('aria-checked', 'false');
  await watching.click();
  await expect(watching).toHaveAttribute('aria-checked', 'true');
  await completed.click();
  await completed.click();
  await expect(completed).toHaveAttribute('aria-checked', 'mixed');
  await expect(page.getByText('Include', { exact: true })).toBeVisible();
  await expect(page.getByText('Exclude', { exact: true })).toBeVisible();
  await shots('updates-settings');

  // It all comes back from the main process after a reload.
  await page.reload();
  await expect(page.getByLabel('Check every')).toHaveValue('24');
  await expect(page.getByRole('checkbox', { name: 'Anime you have not started' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Anime that are completed' })).not.toBeChecked();
  await expect(page.getByLabel('Number of unwatched episodes')).toHaveValue('5');
  await expect(page.getByRole('switch', { name: 'Download new episodes automatically' })).toBeChecked();
  await expect(watching).toHaveAttribute('aria-checked', 'true');
  await expect(planned).toHaveAttribute('aria-checked', 'false');
  await expect(completed).toHaveAttribute('aria-checked', 'mixed');
  const categories = await invoke<{ name: string; autoDownload: string | null }[]>('categories.list');
  expect(categories.map((c) => [c.name, c.autoDownload])).toEqual([
    ['Watching', 'include'],
    ['Plan to watch', null],
    ['Completed', 'exclude'],
  ]);

  // Back to rules that let a check look at everything, and nothing is downloaded on its own.
  await page.getByRole('checkbox', { name: 'Anime you have not started' }).click();
  await expect(page.getByRole('checkbox', { name: 'Anime you have not started' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Anime with more than' }).click();
  await expect(page.getByRole('checkbox', { name: 'Anime with more than' })).not.toBeChecked();
  await expect(page.getByLabel('Number of unwatched episodes')).toBeDisabled();
  await page.getByRole('switch', { name: 'Download new episodes automatically' }).click();
  await expect.poll(async () => (await invoke<Record<string, unknown>>('settings.get'))['autoDownload']).toBe(false);
  expect(await invoke<Record<string, unknown>>('settings.get')).toMatchObject({
    updateIntervalHours: 24,
    updateSkipCompleted: false,
    updateSkipNotStarted: false,
    updateSkipUnwatchedOver: null,
  });
});

test('new episodes show up grouped under Today with a badge, and leave as they are watched', async () => {
  const sky = await animeIdOf('Sky Harbor');
  await invoke('anime.refresh', { animeId: sky });
  await invoke('library.add', { animeId: sky, categoryIds: [] });

  await go('#/updates');
  await expect(page.getByRole('heading', { name: 'No new episodes' })).toBeVisible();
  await expect(sidebarUpdates()).not.toContainText(/\d/);

  site.setEpisodeCount('sky-harbor', 14);
  await checkNow();
  await expect(page.getByRole('heading', { level: 2, name: 'Today' })).toBeVisible();
  await expect(rows()).toHaveCount(2);
  await expect(page.getByText('2 new episodes', { exact: true })).toBeVisible();
  await expect(sidebarUpdates()).toContainText('2');
  await expect(rows().first()).toContainText('Sky Harbor');
  await expect(rows().first()).toContainText('Example');
  await expect(page.getByText(/Last checked today at/)).toBeVisible();
  await shots('updates');

  // Marking one watched takes it off the list and the badge down to 1.
  await rows()
    .first()
    .getByRole('button', { name: /as watched/ })
    .click();
  await expect(rows()).toHaveCount(1);
  await expect(sidebarUpdates()).toContainText('1');

  // "Mark all as watched" asks first.
  await page.getByRole('button', { name: 'Mark all as watched' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark all as watched' }).click();
  await expect(page.getByRole('heading', { name: 'No new episodes' })).toBeVisible();
  await expect(sidebarUpdates()).not.toContainText(/\d/);
  await shot('updates-empty-mocha');
});

test('selected episodes can be marked together, and an episode can be downloaded from the row', async () => {
  site.setEpisodeCount('sky-harbor', 16);
  await go('#/updates');
  await checkNow();
  await expect(rows()).toHaveCount(2);

  await rows().first().getByRole('checkbox').click();
  await expect(page.getByText('1 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Mark as watched', exact: true }).click();
  await expect(rows()).toHaveCount(1);
  await expect(page.getByText('1 selected')).toBeHidden();

  await rows()
    .first()
    .getByRole('button', { name: /^Download/ })
    .click();
  await expect(rows().first()).toContainText(/Queued|Downloading|Downloaded|Download failed/);
  await expect(rows().first().getByRole('link', { name: /^Play/ })).toBeVisible();
});

test('anime that could not be checked are listed with a Retry that works once the site is back', async () => {
  await site.stop();
  await go('#/updates');
  await checkNow();
  const banner = page.getByRole('alert').filter({ hasText: 'could not be checked' });
  await expect(banner).toContainText('1 anime could not be checked.');
  await expect(banner).toContainText('Sky Harbor');
  await shots('updates-failed');

  await site.resume();
  await banner.getByRole('button', { name: 'Retry' }).click();
  await expect(banner).toBeHidden();
});

test('a notification click or the tray can open Updates through app.navigate', async () => {
  await go('#/library');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('app.navigate', { to: '/updates' });
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Updates' })).toBeVisible();
  expect(page.url()).toContain('#/updates');
});
