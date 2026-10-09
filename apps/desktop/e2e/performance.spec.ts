import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 2, milestone 2d: a library of 1,000 anime and 50,000 episodes (docs/PRD.md §10.1). The numbers are
// attached to the report; the limits here are looser than the targets because CI machines are slow.

const ROOT = resolve(__dirname, '../../..');

test('opens a library of 1,000 anime quickly, and only renders the cards in view', async () => {
  execFileSync(process.execPath, [resolve(ROOT, 'packages/extension-cli/dist/cli.js'), '--version'], { stdio: 'pipe' });
  const first = await launchApp();
  await first.page.waitForSelector('nav', { timeout: 30_000 });
  await first.page.evaluate(() =>
    (window as unknown as { api: { invoke(c: string, i: unknown): Promise<unknown> } }).api.invoke('dev.seedLibrary', {
      anime: 1000,
      episodesPerAnime: 50,
    }),
  );
  await first.app.close();

  // A cold start on a library this size: from launching the process to the first card on screen.
  const started = Date.now();
  const { app, page } = await launchApp({}, { userData: first.userData });
  await page.waitForSelector('nav', { timeout: 30_000 });
  await page.evaluate(() => {
    window.location.hash = '#/library';
  });
  await expect(page.getByRole('link', { name: /^Anime number/ }).first()).toBeVisible({ timeout: 15_000 });
  const startup = Date.now() - started;
  await expect(page.getByText('1000 anime')).toBeVisible();

  // Opening the library again from another page: the list query and the first paint.
  await page.evaluate(() => {
    window.location.hash = '#/history';
  });
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  const reopened = Date.now();
  await page.evaluate(() => {
    window.location.hash = '#/library';
  });
  await expect(page.getByRole('link', { name: /^Anime number/ }).first()).toBeVisible();
  const reopen = Date.now() - reopened;

  // Only the rows in view exist, at the top and after scrolling to the very end.
  const cards = () => page.locator('main a[aria-label^="Anime number"]').count();
  expect(await cards()).toBeGreaterThan(0);
  expect(await cards()).toBeLessThan(120);
  await page.getByRole('button', { name: /^Sort:/ }).click();
  await page.getByRole('menuitemradio', { name: 'Title' }).click();
  await expect(page.getByRole('link', { name: 'Anime number 0', exact: true })).toBeVisible();
  await page.locator('main').evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect(page.getByRole('link', { name: 'Anime number 999', exact: true })).toBeVisible();
  expect(await cards()).toBeLessThan(120);

  // Text search over the whole library.
  const searching = Date.now();
  await page.getByRole('searchbox', { name: 'Filter library' }).fill('number 777');
  await expect(page.getByRole('link', { name: 'Anime number 777', exact: true })).toBeVisible();
  const search = Date.now() - searching;

  const report = `cold start to first card ${startup} ms, library reopened ${reopen} ms, search ${search} ms`;
  test.info().annotations.push({ type: 'performance', description: report });
  if (process.env['PERF_OUT']) (await import('node:fs')).writeFileSync(process.env['PERF_OUT'], report);
  expect(startup).toBeLessThan(5000); // target 2000 ms on a mid-range machine
  expect(reopen).toBeLessThan(1500);
  await app.close();
});
