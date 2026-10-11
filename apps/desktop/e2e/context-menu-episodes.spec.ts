import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Locator, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// The right-click menu of an episode row on the anime page, driven through the real app, extension and test site.

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

const row = (number: number): Locator => page.getByRole('listitem').filter({ hasText: `Episode ${number}` });
const menuItem = (name: string | RegExp): Locator =>
  page.getByRole('menuitem', { name, exact: typeof name === 'string' });
/** Right-clicks the title of a row, as a user would, and waits for the menu. */
async function openMenu(number: number): Promise<void> {
  await row(number).getByText(`Episode ${number}`).click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
}
const downloadOf = async (episodeId: number) =>
  (await invoke<{ episodeId: number; status: string }[]>('downloads.list')).find(
    (item) => item.episodeId === episodeId,
  );

let animeId: number;
let episodes: Record<number, number>;

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

  const found = await invoke<{ items: { animeId: number; title: string }[] }>('sources.browse', {
    sourceId: 'example/en',
    kind: 'search',
    page: 1,
    query: 'Long Wave',
  });
  animeId = found.items.find((item) => item.title === 'Long Wave')!.animeId;
  const refreshed = await invoke<{ episodes: { id: number; number: number }[] }>('anime.refresh', { animeId });
  episodes = Object.fromEntries(refreshed.episodes.map((episode) => [episode.number, episode.id]));
});
test.afterAll(async () => {
  await app?.close();
  await site?.close();
});

test('offers what fits an unwatched episode with no download, and marks it watched', async () => {
  await go(`#/anime/${animeId}`);
  await expect(page.getByRole('listitem')).toHaveCount(3);

  await openMenu(3);
  for (const name of ['Play', 'Mark as watched', 'Mark all previous as watched', 'Download', 'Select episode']) {
    await expect(menuItem(name)).toBeVisible();
  }
  await expect(menuItem('Reset progress')).toBeDisabled();
  await expect(menuItem('Mark as not watched')).toHaveCount(0);
  await expect(menuItem('Cancel download')).toHaveCount(0);
  await expect(menuItem('Delete downloaded file')).toHaveCount(0);

  await menuItem('Mark as watched').click();
  await expect(row(3)).toContainText('Watched');
  await expect(page.getByText('3 total · 2 unwatched')).toBeVisible();

  // Now it can be taken back, or reset.
  await openMenu(3);
  await expect(menuItem('Mark as not watched')).toBeVisible();
  await expect(menuItem('Mark as watched')).toHaveCount(0);
  await expect(menuItem('Reset progress')).toBeEnabled();
  await menuItem('Reset progress').click();
  await expect(page.getByText('3 total · 3 unwatched')).toBeVisible();

  // "Mark all previous" works on the row that was clicked.
  await openMenu(3);
  await menuItem('Mark all previous as watched').click();
  await expect(page.getByText('3 total · 1 unwatched')).toBeVisible();
  await expect(row(1)).toContainText('Watched');
  await expect(row(2)).toContainText('Watched');
  await openMenu(1);
  await menuItem('Mark as not watched').click();
  await openMenu(2);
  await menuItem('Mark as not watched').click();
  await expect(page.getByText('3 total · 3 unwatched')).toBeVisible();
});

test('plays an episode from the menu', async () => {
  await openMenu(2);
  await menuItem('Play').click();
  await expect(page).toHaveURL(new RegExp(`#/watch/${episodes[2]}`));
  await go(`#/anime/${animeId}`);
  await expect(page.getByRole('listitem')).toHaveCount(3);
});

test('downloads, then cancels, an episode from the menu', async () => {
  site.setThrottle({ segmentDelayMs: 1000 });
  await openMenu(1);
  await menuItem('Download').click();
  await expect(page.getByText('Queued 1 episode')).toBeVisible();
  await expect.poll(() => downloadOf(episodes[1]!).then((item) => item?.status)).toMatch(/queued|downloading/);

  // A download in progress offers to be cancelled, not started again.
  await openMenu(1);
  await expect(menuItem('Download')).toHaveCount(0);
  await expect(menuItem('Delete downloaded file')).toHaveCount(0);
  await menuItem('Cancel download').click();
  await expect.poll(() => downloadOf(episodes[1]!)).toBeUndefined();

  await openMenu(1);
  await expect(menuItem('Download')).toBeVisible();
  await expect(menuItem('Cancel download')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('deletes the file of a finished download after asking', async () => {
  site.setThrottle({});
  await openMenu(1);
  await menuItem('Download').click();
  await expect.poll(() => downloadOf(episodes[1]!).then((item) => item?.status), { timeout: 45_000 }).toBe('done');
  await expect(row(1)).toContainText('Downloaded');

  await openMenu(1);
  await expect(menuItem('Download')).toHaveCount(0);
  await expect(menuItem('Cancel download')).toHaveCount(0);
  await menuItem('Delete downloaded file').click();

  // The files go only after the user agrees.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Delete this download?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await downloadOf(episodes[1]!))?.status).toBe('done');

  await openMenu(1);
  await menuItem('Delete downloaded file').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => downloadOf(episodes[1]!)).toBeUndefined();
  await expect(row(1)).not.toContainText('Downloaded');
  // The page is still usable after the dialog.
  await openMenu(1);
  await expect(menuItem('Download')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('acts on the whole selection from a selected row, and on one row from any other', async () => {
  await row(3).getByRole('button', { name: 'Select episode' }).click({ force: true });
  await row(2).getByRole('button', { name: 'Select episode' }).click({ force: true });
  await expect(page.getByRole('toolbar')).toContainText('2 selected');

  // A row outside the selection: only that row, and the selection stays.
  await openMenu(1);
  await expect(menuItem('Play')).toBeVisible();
  await menuItem('Mark as watched').click();
  await expect(row(1)).toContainText('Watched');
  await expect(row(2)).not.toContainText('Watched');
  await expect(row(3)).not.toContainText('Watched');
  await expect(page.getByRole('toolbar')).toContainText('2 selected');

  // A selected row: both selected rows, and the selection is let go.
  await openMenu(2);
  await expect(menuItem('Play')).toHaveCount(0);
  await expect(menuItem('Mark all previous as watched')).toHaveCount(0);
  await expect(menuItem('Deselect episode')).toBeVisible();
  await menuItem('Mark as watched').click();
  await expect(row(2)).toContainText('Watched');
  await expect(row(3)).toContainText('Watched');
  await expect(page.getByRole('toolbar')).toHaveCount(0);

  // "Select episode" selects the row it was opened on.
  await openMenu(3);
  await menuItem('Select episode').click();
  await expect(page.getByRole('toolbar')).toContainText('1 selected');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('toolbar')).toHaveCount(0);
});
