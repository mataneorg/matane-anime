import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Right-click menus on the anime cards of a source's list and on the rows of the source list.

const ROOT = resolve(__dirname, '../../..');
const EXAMPLE = resolve(ROOT, 'extensions/example');

test.describe.configure({ mode: 'serial' });

let site: TestSite;
let app: ElectronApplication;
let page: Page;

const go = async (hash: string): Promise<void> => {
  await page.evaluate((value) => {
    window.location.hash = value;
  }, hash);
};
const invoke = <T = unknown>(channel: string, input?: unknown): Promise<T> =>
  page.evaluate(
    ([c, i]) =>
      (window as unknown as { api: { invoke(c: string, i?: unknown): Promise<unknown> } }).api.invoke(c as string, i),
    [channel, input] as const,
  ) as Promise<T>;
const libraryTitles = async (): Promise<string[]> =>
  (await invoke<{ title: string }[]>('library.list', { sort: 'title' })).map((item) => item.title);
const card = (title: string) => page.locator('a[href*="/anime/"]').filter({ hasText: title });

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

test('a source row opens a menu: pin, unpin and search every source', async () => {
  await go('#/browse/sources');
  const row = page.getByRole('listitem').filter({ hasText: 'Example Site (EN)' }).first();
  await expect(row).toBeVisible();

  await row.click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['Open', 'Pin source', 'Search all sources']);
  await menu.getByRole('menuitem', { name: 'Pin source' }).click();
  await expect(page.getByRole('region', { name: 'Pinned' })).toContainText('Example Site (EN)');
  await expect
    .poll(
      async () =>
        (await invoke<{ id: string; pinned: boolean }[]>('sources.list')).find((s) => s.id === 'example/en')?.pinned,
    )
    .toBe(true);

  // Now pinned, the same row (the one in the Pinned group) offers the way back.
  await page.getByRole('region', { name: 'Pinned' }).getByRole('listitem').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Unpin source' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Unpin source' }).click();
  await expect(page.getByRole('region', { name: 'Pinned' })).toHaveCount(0);

  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(/#\/browse\/sources\/example%2Fen/);

  await go('#/browse/sources');
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Search all sources' }).click();
  await expect(page).toHaveURL(/#\/browse\/global-search/);
  await expect(page.getByRole('searchbox', { name: 'Search every source' })).toBeFocused();
});

test('an anime card adds to and removes from the library', async () => {
  await go('#/browse/sources/example%2Fen');
  await expect(card('Sky Harbor')).toBeVisible();
  expect(await libraryTitles()).not.toContain('Sky Harbor');

  await card('Sky Harbor').click({ button: 'right' });
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Open', 'Add to library', 'Add to category…']);
  await page.getByRole('menuitem', { name: 'Add to library' }).click();
  await expect.poll(libraryTitles).toContain('Sky Harbor');
  await expect(card('Sky Harbor')).toContainText('In library');

  // In the library the menu changes: categories can be moved, and the removal asks first.
  await card('Sky Harbor').click({ button: 'right' });
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
    'Open',
    'Move to category',
    'Remove from library',
  ]);
  await page.getByRole('menuitem', { name: 'Remove from library' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Remove 1 anime from your library?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await libraryTitles()).toContain('Sky Harbor');

  await card('Sky Harbor').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove from library' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove from library' }).click();
  await expect.poll(libraryTitles).not.toContain('Sky Harbor');
  await expect(card('Sky Harbor')).not.toContainText('In library');
});

test('an anime card adds to a chosen category, and Open goes to the anime', async () => {
  const category = await invoke<{ id: number }>('categories.create', { name: 'Weekend' });
  await go('#/browse/sources/example%2Fen');
  await expect(card('Two Voices')).toBeVisible();

  await card('Two Voices').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add to category…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: /Weekend/ }).check();
  await dialog.getByRole('button', { name: 'Add to library' }).click();
  await expect
    .poll(async () => {
      const items = await invoke<{ title: string; categoryIds: number[] }[]>('library.list', { sort: 'title' });
      return items.find((item) => item.title === 'Two Voices')?.categoryIds;
    })
    .toEqual([category.id]);
  await expect(card('Two Voices')).toContainText('In library');

  await card('Two Voices').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Two Voices' })).toBeVisible();
});
