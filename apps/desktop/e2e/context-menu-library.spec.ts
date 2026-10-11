import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// The right-click menus of the library: on a card (one anime, or the whole selection) and on a category tab.

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
const card = (title: string) => page.getByRole('link', { name: title, exact: true });
const unwatchedOf = async (title: string): Promise<number | undefined> =>
  (await invoke<{ title: string; unwatched: number }[]>('library.list', { sort: 'title' })).find(
    (item) => item.title === title,
  )?.unwatched;
const categories = () => invoke<{ name: string; autoDownload: string | null }[]>('categories.list');
const categoryNames = async (): Promise<string[]> => (await categories()).map((category) => category.name);

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
  for (const title of ['Sky Harbor', 'Two Voices', 'Quiet Orchard']) {
    const animeId = await animeIdOf(title);
    await invoke('anime.refresh', { animeId });
    await invoke('library.add', { animeId, categoryIds: [] });
  }
  await go('#/library');
  await expect(card('Sky Harbor')).toBeVisible();
});
test.afterAll(async () => {
  await app?.close();
  await site?.close();
});

test('right-clicking a card offers its actions without entering select mode', async () => {
  await card('Two Voices').click({ button: 'right' });
  const menu = page.getByRole('menu');
  for (const name of [
    /^Continue/,
    'Open',
    'Mark as watched',
    'Move to category…',
    'Download',
    'Migrate to another source…',
    'Select',
    'Remove from library',
  ]) {
    await expect(menu.getByRole('menuitem', { name })).toBeVisible();
  }
  // The removal comes last.
  await expect(menu.getByRole('menuitem').last()).toHaveText('Remove from library');
  await expect(page.getByRole('toolbar')).toHaveCount(0);

  await menu.getByRole('menuitem', { name: 'Mark as watched' }).click();
  await expect.poll(() => unwatchedOf('Two Voices')).toBe(0);
  expect(await unwatchedOf('Sky Harbor')).toBeGreaterThan(0);
  await expect(page.getByRole('toolbar')).toHaveCount(0);
});

test('Open and Continue navigate, Migrate opens its dialog', async () => {
  await card('Sky Harbor').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Migrate to another source…' }).click();
  await expect(page.getByRole('dialog').getByText('Migrate to another source').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await card('Sky Harbor').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Continue Ep/ }).click();
  await expect(page).toHaveURL(/#\/watch\//);
  await page.keyboard.press('Escape');

  await go('#/library');
  await card('Quiet Orchard').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Quiet Orchard' })).toBeVisible();
  await go('#/library');
});

test('a card inside the selection acts on all of it; another card only on itself', async () => {
  // Select starts a selection from the menu; a click then adds a second card.
  await card('Sky Harbor').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Select' }).click();
  await expect(page.getByRole('toolbar')).toContainText('1 selected');
  await page.getByRole('checkbox', { name: 'Two Voices' }).click();
  await expect(page.getByRole('toolbar')).toContainText('2 selected');

  // On a selected card the single-anime rows are gone and the move applies to both.
  await page.getByRole('checkbox', { name: 'Two Voices' }).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Open' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /^Migrate/ })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Select' })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Move to category…' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('New category').fill('Watching');
  await dialog.getByRole('button', { name: 'Add category' }).click();
  await dialog.getByRole('checkbox', { name: /Watching/ }).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('tab', { name: /^Watching\s*2/ })).toBeVisible();
  await expect(page.getByRole('toolbar')).toContainText('2 selected');

  // A card outside the selection: only it is removed, and the selection stays.
  await page.getByRole('checkbox', { name: 'Quiet Orchard' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove from library' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Remove 1 anime from your library?');
  await dialog.getByRole('button', { name: 'Remove from library' }).click();
  // While selecting, the cards are checkboxes.
  await expect(page.getByRole('checkbox', { name: 'Quiet Orchard' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Sky Harbor' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Two Voices' })).toBeChecked();
  await expect(page.getByRole('toolbar')).toContainText('2 selected');
  await page.getByRole('button', { name: 'Cancel' }).click();
});

test('category tabs: rename, auto-download, reorder and delete; All and Default have no menu', async () => {
  await invoke('categories.create', { name: 'Later' });
  await invoke('categories.create', { name: 'Archive' });
  await expect(page.getByRole('tab', { name: /^Archive/ })).toBeVisible();
  expect(await categoryNames()).toEqual(['Watching', 'Later', 'Archive']);

  await page.getByRole('tab', { name: /^All/ }).click({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('tab', { name: /^Default/ }).click({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(0);

  // The first tab cannot go left, the last cannot go right.
  await page.getByRole('tab', { name: /^Watching/ }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Move left' })).toHaveAttribute('data-disabled', '');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /^Archive/ }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Move right' })).toHaveAttribute('data-disabled', '');
  await page.getByRole('menuitem', { name: 'Move left' }).click();
  await expect.poll(categoryNames).toEqual(['Watching', 'Archive', 'Later']);

  await page.getByRole('tab', { name: /^Archive/ }).click({ button: 'right' });
  await page.getByRole('menuitemcheckbox', { name: 'Auto-download new episodes' }).click();
  await expect.poll(async () => (await categories())[1]?.autoDownload).toBe('include');
  await page.getByRole('tab', { name: /^Archive/ }).click({ button: 'right' });
  await expect(page.getByRole('menuitemcheckbox', { name: 'Auto-download new episodes' })).toBeChecked();
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: /^Archive/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Category name').fill('Done');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(categoryNames).toEqual(['Watching', 'Done', 'Later']);

  await page.getByRole('tab', { name: /^Done/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete category…' }).click();
  await expect(page.getByRole('dialog')).toContainText('Delete the category "Done"?');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Done' }).click();
  await expect.poll(categoryNames).toEqual(['Watching', 'Later']);
  await expect(page.getByRole('tab', { name: /^Done/ })).toHaveCount(0);
});
