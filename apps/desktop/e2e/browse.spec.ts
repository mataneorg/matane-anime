import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 1, milestone 1c: browse, detail and extensions as a user sees them.

const ROOT = resolve(__dirname, '../../..');
const EXAMPLE = resolve(ROOT, 'extensions/example');
const SHOTS = resolve(__dirname, '../test-results/screens');

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
const shot = async (name: string): Promise<void> => {
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`) });
};
const cards = () => page.locator('a[href*="/anime/"]');

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
});
test.afterAll(async () => {
  await app?.close();
  await site?.close();
});

test('starts with no sources and says how to get some', async () => {
  await go('#/browse/sources');
  await expect(page.getByRole('heading', { name: 'No sources installed' })).toBeVisible();
  await go('#/browse/extensions');
  await expect(page.getByRole('heading', { name: 'No extensions loaded' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load from folder' })).toBeVisible();
});

test('loads an extension and lists its sources', async () => {
  await invoke('extensions.loadDevFolder', { folder: EXAMPLE });
  await invoke('extensions.setPreference', { extensionId: 'example', key: 'baseUrl', value: site.origin });
  await expect(page.getByText('Example Site', { exact: true })).toBeVisible();
  await expect(page.getByText('Dev', { exact: true })).toBeVisible();
  await shot('extensions');

  await go('#/browse/sources');
  await expect(page.getByText('Example Site (EN)')).toBeVisible();
  await expect(page.getByText('Example Site (ID)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'EN', exact: true })).toBeVisible();
  await shot('sources');
});

test('browses a source: covers load, tabs work, the list keeps loading as you scroll', async () => {
  await go('#/browse/sources/example%2Fen');
  await expect(cards().first()).toBeVisible();
  await expect.poll(() => cards().count()).toBeGreaterThanOrEqual(12); // more may already have loaded, on a tall window
  await expect(page.getByRole('combobox', { name: 'Source' })).toHaveValue('example/en');

  // Covers come through anime://cover: an <img> that decoded has a width.
  const loaded = await page.evaluate(async () => {
    const images = [...document.querySelectorAll<HTMLImageElement>('a[href*="/anime/"] img')];
    await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
    return images.filter((image) => image.naturalWidth > 0 && image.src.startsWith('anime://cover/')).length;
  });
  expect(loaded).toBeGreaterThanOrEqual(10);
  await shot('browse-popular');

  // Keep scrolling: the list loads page after page until the source has no more.
  await expect(async () => {
    await page.locator('main').evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect(page.getByText('That is everything')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(cards()).toHaveCount(35); // 35 anime in the fake catalog
  await expect(page.getByText('That is everything')).toBeVisible();

  await page.getByRole('tab', { name: 'Latest' }).click();
  await expect(page.getByText('Filler Series 24')).toBeVisible();
});

test('searches and filters', async () => {
  await go('#/browse/sources/example%2Fen');
  await page.getByRole('searchbox', { name: 'Search this source' }).fill('sky');
  await page.getByRole('searchbox', { name: 'Search this source' }).press('Enter');
  await expect(cards()).toHaveCount(1);
  await expect(page.getByText('Sky Harbor')).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search this source' }).fill('');
  await page.getByRole('searchbox', { name: 'Search this source' }).press('Enter');
  await expect.poll(() => cards().count()).toBeGreaterThanOrEqual(12); // more may already have loaded, on a tall window

  await page.getByRole('button', { name: 'Show filters' }).click();
  await expect(page.getByRole('complementary', { name: 'Filters' })).toBeVisible();
  await page.getByRole('checkbox', { name: /^drama/ }).click(); // include
  await page.getByRole('checkbox', { name: /^comedy/ }).click();
  await page.getByRole('checkbox', { name: /^comedy/ }).click(); // exclude
  await shot('browse-filters');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByText('Two Voices')).toBeVisible();
  await expect(page.getByText('Sky Harbor')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect.poll(() => cards().count()).toBeGreaterThanOrEqual(12); // more may already have loaded, on a tall window
});

test('shows a clear error with a way forward, then recovers', async () => {
  await invoke('extensions.setPreference', { extensionId: 'example', key: 'baseUrl', value: 'http://127.0.0.1:9' });
  await go('#/browse/sources/example%2Fid');
  await expect(page.getByRole('alert')).toContainText('Could not reach the site');
  await shot('browse-error');
  await invoke('extensions.setPreference', { extensionId: 'example', key: 'baseUrl', value: site.origin });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => cards().count()).toBeGreaterThanOrEqual(12); // more may already have loaded, on a tall window
});

test('opens a pasted URL', async () => {
  await go('#/browse/sources');
  await page.getByLabel('Open from URL').fill(`${site.origin}/anime/quiet-orchard`);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'quiet orchard' })).toBeVisible();
  await page.getByLabel('Open from URL').count();
});

test('shows an anime: details come in on their own, episodes are listed, errors keep old data', async () => {
  await go('#/browse/sources/example%2Fen');
  await cards().filter({ hasText: 'Sky Harbor' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sky Harbor' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Sky Harbor');
  await expect(page.getByText('Sora no Minato · Hafen im Himmel')).toBeVisible();
  await expect(page.getByText('12 total')).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(12);
  await expect(page.getByText('Ongoing')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start watching' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to library' })).toBeEnabled(); // the library arrived in phase 2
  await shot('detail');

  await page.getByLabel('Newest first').selectOption('oldest');
  await expect(page.getByRole('listitem').first()).toContainText('Episode 1');

  await invoke('extensions.setPreference', { extensionId: 'example', key: 'baseUrl', value: 'http://127.0.0.1:9' });
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not refresh this anime');
  await expect(page.getByRole('alert')).toContainText('Showing what was saved earlier');
  await expect(page.getByRole('listitem')).toHaveCount(12);
  await shot('detail-error');
  await invoke('extensions.setPreference', { extensionId: 'example', key: 'baseUrl', value: site.origin });
});

test('virtualizes a long episode list', async () => {
  await go('#/browse/sources/example%2Fen');
  await page.getByRole('searchbox', { name: 'Search this source' }).fill('long');
  await page.getByRole('searchbox', { name: 'Search this source' }).press('Enter');
  await cards().filter({ hasText: 'Long Runner' }).click();
  await expect(page.getByText('120 total')).toBeVisible();
  const rendered = await page.getByRole('listitem').count();
  expect(rendered).toBeGreaterThan(5);
  expect(rendered).toBeLessThan(40);

  await page.locator('main').evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect(page.getByRole('listitem').last()).toContainText('Episode 1');
  expect(await page.getByRole('listitem').count()).toBeLessThan(40);
});

test('edits extension preferences and reads the log in Settings', async () => {
  await go('#/browse/extensions');
  await page.getByRole('button', { name: 'Preferences' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Show dubbed episodes');
  await dialog.getByRole('switch', { name: 'Show dubbed episodes' }).click();
  await expect
    .poll(
      async () =>
        (await invoke<{ values: Record<string, unknown> }>('extensions.preferences', { extensionId: 'example' }))
          .values['showDub'],
    )
    .toBe(false);
  await shot('preferences');
  await page.keyboard.press('Escape');
  await invoke('extensions.setPreference', { extensionId: 'example', key: 'showDub', value: true });

  await go('#/settings/advanced');
  await expect(page.getByRole('heading', { name: 'Extension logs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load from folder' })).toBeVisible();
});

test('hides 18+ sources until the user asks for them', async () => {
  await go('#/settings/general');
  const toggle = page.getByRole('switch', { name: 'Show 18+ sources' });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
});

test('looks right in Latte too', async () => {
  await invoke('settings.set', { theme: 'latte' });
  await go('#/browse/sources/example%2Fen');
  await expect(cards().first()).toBeVisible();
  await shot('browse-latte');
  await invoke('settings.set', { theme: 'mocha' });
});
