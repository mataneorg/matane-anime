import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 2, milestone 2e: the whole of phase 2 as one person would use it, across an app restart.
// search -> open -> add to library -> watch part of it -> CLOSE THE APP AND OPEN IT AGAIN -> progress and
// Continue are still there -> pass the threshold -> next episode -> history -> migrate -> remove.

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
const currentTime = () => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime);

/** Waits for the window and for the extension loaded from the folder remembered in the profile. */
async function ready(): Promise<void> {
  await page.waitForSelector('nav', { timeout: 30_000 });
  await expect
    .poll(async () => (await invoke<{ id: string }[]>('sources.list')).map((s) => s.id), { timeout: 20_000 })
    .toContain('example/en');
}

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  site = await TestSite.start({ mediaDir: resolve(__dirname, 'fixtures/media') });
  execFileSync(process.execPath, [resolve(ROOT, 'packages/extension-cli/dist/cli.js'), 'build', EXAMPLE], {
    stdio: 'pipe',
  });
  ({ app, page, userData } = await launchApp());
  await page.waitForSelector('nav', { timeout: 30_000 });
  await invoke('extensions.loadDevFolder', { folder: EXAMPLE });
  await invoke('extensions.setPreference', { extensionId: 'example', key: 'baseUrl', value: site.origin });
});
test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  await site?.close();
});

test('finds an anime across the sources, adds it to the library and watches part of it', async () => {
  await page.getByRole('button', { name: /Search library, sources, episodes/ }).click();
  await page.getByRole('combobox', { name: 'Search the app' }).fill('Long Night');
  await page.getByRole('combobox', { name: 'Search the app' }).press('Tab');
  await expect(page.getByRole('searchbox', { name: 'Search every source' })).toHaveValue('Long Night');
  const english = page.getByRole('listitem').filter({ hasText: 'Example Site (EN)' });
  await expect(english).toContainText('1 result', { timeout: 20_000 });
  await english.getByRole('link', { name: 'Long Night' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Long Night' })).toBeVisible();

  await page.getByRole('button', { name: 'Add to library' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('New category').fill('Watching');
  await dialog.getByRole('button', { name: 'Add category' }).click();
  await dialog.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByRole('button', { name: 'In library · Watching' })).toBeVisible();

  await page.getByRole('link', { name: 'Start watching' }).click();
  await expect.poll(currentTime, { timeout: 20_000 }).toBeGreaterThan(0.8);
  await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.currentTime = 20;
  });
  // Five seconds of real playing put it in the history, and a heartbeat saves the position.
  await page.waitForTimeout(6500);
  await page.keyboard.press('Escape');
});

test('after closing and opening the app again, the library still has the progress and Continue resumes', async () => {
  await app.close();
  ({ app, page } = await launchApp({}, { userData }));
  await ready();

  await go('#/library');
  await expect(page.getByRole('link', { name: 'Long Night', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Watching\s*1/ })).toBeVisible();
  await expect(page.getByText('Ep 1 / 3 · EN')).toBeVisible();
  await page.getByRole('link', { name: 'Long Night', exact: true }).hover();
  await shot('restart-library');
  await page.getByRole('link', { name: 'Continue Ep 1' }).click();
  // 20 s saved, minus three seconds, plus the moment it took to start.
  await expect.poll(currentTime, { timeout: 20_000 }).toBeGreaterThan(16.5);
  expect(await currentTime()).toBeLessThan(25);
});

test('passing the threshold marks it watched, and Continue then offers the next episode', async () => {
  // 85% of 40 s is 34 s.
  await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.currentTime = 36;
  });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');

  await go('#/library');
  await page.getByRole('link', { name: 'Long Night', exact: true }).hover();
  await expect(page.getByRole('link', { name: 'Continue Ep 2' })).toBeVisible();

  await go('#/history');
  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Long Night');
  await expect(rows.first()).toContainText('Watched');
  await expect(rows.first().getByRole('link', { name: 'Play Ep 2' })).toBeVisible();
  await shot('restart-history');
});

test('migrating to the other source keeps what was watched', async () => {
  const coversDir = join(userData, 'covers');
  const before = existsSync(coversDir) ? readdirSync(coversDir) : [];
  expect(before).toHaveLength(1);
  await go('#/library');
  await page.getByRole('link', { name: 'Long Night', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Long Night' })).toBeVisible();
  await page.getByRole('button', { name: 'Migrate to another source' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('1 of 1 sources done')).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Long Night' }).click();
  await expect(dialog.getByRole('status')).toContainText('1 of 1 episodes with progress match', { timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Migrate', exact: true }).click();

  await expect(page.getByText('Example Site (ID)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'In library · Watching' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue Ep 2' })).toBeVisible();
  // The permanent cover moved with it: the new entry has its own file and the old one is gone.
  await expect
    .poll(() => readdirSync(coversDir).filter((name) => !before.includes(name)).length, { timeout: 10_000 })
    .toBe(1);
  expect(readdirSync(coversDir)).toHaveLength(1);
  await go('#/library');
  await expect(page.getByRole('tab', { name: /^All\s*1/ })).toBeVisible();
  await shot('restart-migrated');
});

test('removing it from the library empties the library but keeps the history', async () => {
  await page.getByRole('button', { name: 'Select' }).click();
  await page.getByRole('checkbox', { name: 'Long Night' }).click();
  await page.getByRole('button', { name: 'Remove from library' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove from library' }).click();
  await expect(page.getByRole('heading', { name: 'Your library is empty' })).toBeVisible();
  // The history belongs to what was watched, not to the library.
  await go('#/history');
  await expect(page.getByRole('listitem')).toHaveCount(1);
});
