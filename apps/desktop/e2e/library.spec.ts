import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 2, milestone 2b: the library, categories, progress and resume as a user meets them.

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
async function episodesOf(animeId: number): Promise<{ id: number; number: number; watched: boolean }[]> {
  const { episodes } = await invoke<{ episodes: { id: number; number: number; watched: boolean }[] }>('anime.refresh', {
    animeId,
  });
  return episodes;
}
const card = (title: string) => page.getByRole('link', { name: title, exact: true });

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

test('starts empty with the first steps, then adds an anime from its page with a new category', async () => {
  await go('#/library');
  await expect(page.getByRole('heading', { name: 'Your library is empty' })).toBeVisible();

  const sky = await animeIdOf('Sky Harbor');
  await episodesOf(sky);
  await go(`#/anime/${sky}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Sky Harbor' })).toBeVisible();
  await expect(page.getByText('12 total · 12 unwatched')).toBeVisible();
  await page.getByRole('button', { name: 'Add to library' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('no categories');
  await dialog.getByLabel('New category').fill('Watching');
  await dialog.getByRole('button', { name: 'Add category' }).click();
  await expect(dialog.getByRole('checkbox', { name: /Watching/ })).toBeChecked();
  await shot('library-add-dialog');
  await dialog.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByRole('button', { name: 'In library · Watching' })).toBeVisible();
});

test('shows the library with tabs, counts, an unwatched badge and the cover from disk', async () => {
  await invoke('library.add', { animeId: await animeIdOf('Two Voices'), categoryIds: [] });
  await invoke('library.add', { animeId: await animeIdOf('Quiet Orchard'), categoryIds: [] });
  await go('#/library');
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^All\s*3/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Watching\s*1/ })).toBeVisible();
  await expect(card('Sky Harbor')).toBeVisible();
  await expect(card('Two Voices')).toBeVisible();
  await expect(page.getByTitle('12 unwatched episodes')).toBeVisible();

  // The cover comes from the permanent copy on disk.
  await expect.poll(() => page.locator('img[src^="anime://cover/library/"]').count()).toBeGreaterThanOrEqual(1);
  await shot('library');

  await page.getByRole('tab', { name: /^Watching/ }).click();
  await expect(card('Sky Harbor')).toBeVisible();
  await expect(card('Two Voices')).toHaveCount(0);
  await page.getByRole('tab', { name: /^All/ }).click();
});

test('filters by text, sorts, and narrows to what is unwatched or started', async () => {
  await page.getByRole('searchbox', { name: 'Filter library' }).fill('voices');
  await expect(card('Two Voices')).toBeVisible();
  await expect(card('Sky Harbor')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Filter library' }).fill('');
  await expect(card('Sky Harbor')).toBeVisible();

  await page.getByLabel('Sort by').selectOption('title');
  await expect
    .poll(() =>
      page.locator('main a[aria-label]').evaluateAll((links) => links.map((link) => link.getAttribute('aria-label'))),
    )
    .toEqual(['Quiet Orchard', 'Sky Harbor', 'Two Voices']);

  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByLabel('Only started').check();
  await expect(page.getByText('Nothing matches')).toBeVisible();
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(card('Sky Harbor')).toBeVisible();
  await page.getByRole('button', { name: 'Filters' }).click();
});

test('selects several anime: moves them to a category, marks them watched, removes them', async () => {
  await page.getByRole('button', { name: 'Select' }).click();
  await page.getByRole('checkbox', { name: 'Two Voices' }).click();
  await page.getByRole('checkbox', { name: 'Quiet Orchard' }).click();
  await expect(page.getByRole('toolbar')).toContainText('2 selected');

  await page.getByRole('button', { name: 'Move to category' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: /Watching/ }).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('tab', { name: /^Watching\s*3/ })).toBeVisible();

  await page.getByRole('button', { name: 'Mark as watched' }).click();
  await expect(page.getByTitle(/unwatched episode/)).toHaveCount(1); // only Sky Harbor still has any
  await shot('library-select');

  await page.getByRole('button', { name: 'Remove from library' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Remove from library' }).click();
  await expect(page.getByRole('tab', { name: /^All\s*1/ })).toBeVisible();
  await expect(card('Two Voices')).toHaveCount(0);
  await expect(card('Sky Harbor')).toBeVisible();
});

test('marks episodes on the anime page: one, everything before, and reset', async () => {
  const sky = await animeIdOf('Sky Harbor');
  await go(`#/anime/${sky}`);
  await expect(page.getByRole('listitem')).toHaveCount(12);
  const rows = page.getByRole('listitem');

  // Newest first: the first row is episode 12.
  await rows.nth(7).getByRole('button', { name: 'Episode actions' }).click(); // episode 5
  await page.getByRole('menuitem', { name: 'Mark all previous as watched' }).click();
  await expect(page.getByText('12 total · 8 unwatched')).toBeVisible();
  await rows.nth(7).getByRole('button', { name: 'Episode actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark as watched' }).click();
  await expect(page.getByText('12 total · 7 unwatched')).toBeVisible();
  await expect(rows.nth(7)).toContainText('Watched');

  await page.getByRole('button', { name: 'Unwatched', exact: true }).click();
  await expect(rows).toHaveCount(7);
  await page.getByRole('button', { name: 'Unwatched', exact: true }).click();

  await rows.nth(7).getByRole('button', { name: 'Episode actions' }).click();
  await page.getByRole('menuitem', { name: 'Reset progress' }).click();
  await expect(page.getByText('12 total · 8 unwatched')).toBeVisible();
  await shot('detail-progress');
  await expect(page.getByRole('link', { name: 'Continue Ep 5' })).toBeVisible();
});

test('resumes where you left off: watch, leave, and "Continue" starts three seconds before', async () => {
  const night = await animeIdOf('Long Night');
  const [first] = (await episodesOf(night)).sort((a, b) => a.number - b.number);
  await invoke('library.add', { animeId: night, categoryIds: [] });

  await go(`#/watch/${first!.id}`);
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 })
    .toBeGreaterThan(0.8);
  await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.currentTime = 20;
  });
  // Five seconds of real playing before history is written, plus a heartbeat.
  await page.waitForTimeout(6500);
  await page.keyboard.press('Escape');

  await go('#/library');
  const night1 = card('Long Night');
  await expect(night1).toBeVisible();
  // The last episode watched is shown on the card: it came from the history, which needs real playing time.
  await expect(page.getByText('Ep 1 / 3 · EN')).toBeVisible();
  await night1.hover();
  const continueLink = page.getByRole('link', { name: 'Continue Ep 1' });
  await expect(continueLink).toBeVisible();
  await shot('library-continue');
  await continueLink.click();
  // 20 s saved, minus three seconds, plus the moment it took to start.
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 })
    .toBeGreaterThan(16.5);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(25);
  await page.keyboard.press('Escape');
});

test('watching to the threshold marks an episode watched, and the threshold is a setting', async () => {
  await go('#/settings/player');
  const slider = page.getByLabel('Mark as watched at');
  await expect(slider).toHaveValue('85');
  await slider.fill('50');
  await expect
    .poll(async () => (await invoke<{ playerWatchedThreshold: number }>('settings.get')).playerWatchedThreshold)
    .toBe(50);
  await shot('settings-player-threshold');

  const night = await animeIdOf('Long Night');
  const [, second] = (await episodesOf(night)).sort((a, b) => a.number - b.number);
  await go(`#/watch/${second!.id}`);
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 })
    .toBeGreaterThan(0.8);
  await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.currentTime = 25; // past 50% of 40 s
  });
  await expect
    .poll(async () => (await episodesOf(night)).find((e) => e.id === second!.id)?.watched, { timeout: 15_000 })
    .toBe(true);
  await page.keyboard.press('Escape');
  await invoke('settings.set', { playerWatchedThreshold: 85 });
});

test('manages categories in Settings: add, rename, reorder, delete', async () => {
  await go('#/settings/library');
  await page.getByLabel('New category').fill('Plan to watch');
  await page.getByRole('button', { name: 'Add category' }).click();
  const names = () => page.getByRole('region', { name: 'Categories' }).locator('li span.flex-1').allTextContents();
  await expect.poll(names).toEqual(['Watching', 'Plan to watch']);

  await page.getByRole('button', { name: 'Move Plan to watch up' }).click();
  await expect.poll(names).toEqual(['Plan to watch', 'Watching']);

  await page.getByRole('button', { name: 'Rename Plan to watch' }).click();
  await page.getByLabel('Category name').fill('Later');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(names).toEqual(['Later', 'Watching']);
  await shot('settings-library');

  await page.getByRole('button', { name: 'Delete Later' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Later' }).click();
  await expect.poll(names).toEqual(['Watching']);
});
