import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 2, milestone 2d: moving an anime to the same series on another source (BRW-8).

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

test.beforeAll(async () => {
  site = await TestSite.start({ mediaDir: resolve(__dirname, 'fixtures/media') });
  execFileSync(process.execPath, [resolve(ROOT, 'packages/extension-cli/dist/cli.js'), 'build', EXAMPLE], {
    stdio: 'pipe',
  });
  ({ app, page } = await launchApp());
  await page.waitForSelector('nav', { timeout: 30_000 });
  await invoke('extensions.loadDevFolder', { folder: EXAMPLE });
  await invoke('extensions.setPreference', { extensionId: 'example', key: 'baseUrl', value: site.origin });
});
test.afterAll(async () => {
  await app?.close();
  await site?.close();
});

test('moves an anime to another source and takes progress, categories and history along', async () => {
  const found = await invoke<{ items: { animeId: number; title: string }[] }>('sources.browse', {
    sourceId: 'example/en',
    kind: 'search',
    page: 1,
    query: 'Sky Harbor',
  });
  const from = found.items[0]!.animeId;
  const { episodes } = await invoke<{ episodes: { id: number; number: number }[] }>('anime.refresh', { animeId: from });
  const watching = (await invoke<{ id: number }>('categories.create', { name: 'Watching' })).id;
  await invoke('library.add', { animeId: from, categoryIds: [watching] });
  const byNumber = (n: number) => episodes.find((e) => e.number === n)!.id;
  await invoke('episodes.markWatched', { episodeIds: [byNumber(1), byNumber(2), byNumber(3)], watched: true });
  // Episode 4 is in progress and in the history (five seconds of real playing).
  const send = (reason: string, positionMs: number) =>
    invoke('watch.progress', { playbackId: 'mig', episodeId: byNumber(4), positionMs, durationMs: 1_440_000, reason });
  await send('play', 0);
  await page.waitForTimeout(5300);
  await send('heartbeat', 600_000);
  await send('close', 600_000);

  await go(`#/anime/${from}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Sky Harbor' })).toBeVisible();
  await page.getByRole('button', { name: 'Migrate to another source' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('searchbox', { name: 'Search the other sources' })).toHaveValue('Sky Harbor');
  await expect(dialog.getByText('1 of 1 sources done')).toBeVisible({ timeout: 20_000 });
  // The source it is on is not offered; only the sibling one.
  await expect(dialog).toContainText('Example Site (ID)');
  await expect(dialog).not.toContainText('Example Site (EN)');

  await dialog.getByRole('button', { name: 'Sky Harbor' }).click();
  await expect(dialog.getByRole('status')).toContainText('4 of 4 episodes with progress match', { timeout: 20_000 });
  await expect(dialog).not.toContainText('will lose it');
  await dialog.getByRole('button', { name: 'Migrate', exact: true }).click();

  // Now on the other source's page, in the library, in the same category, with the same episodes watched.
  await expect(page.getByRole('heading', { level: 1, name: 'Sky Harbor' })).toBeVisible();
  await expect(page).not.toHaveURL(new RegExp(`/anime/${from}$`));
  await expect(page.getByRole('button', { name: 'In library · Watching' })).toBeVisible();
  await expect(page.getByText('12 total · 9 unwatched')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue Ep 4' })).toBeVisible();

  await go('#/library');
  await expect(page.getByRole('link', { name: 'Sky Harbor', exact: true })).toHaveCount(1);
  const library = await invoke<
    { animeId: number; sourceId: string; lastEpisode: { number: number; positionMs: number } | null }[]
  >('library.list', { sort: 'title' });
  expect(library).toHaveLength(1);
  expect(library[0]).toMatchObject({ sourceId: 'example/id', lastEpisode: { number: 4, positionMs: 600_000 } });
  expect((await invoke<{ title: string }[]>('history.list')).map((h) => h.title)).toEqual(['Sky Harbor']);
});

test('previews what carries over, and refuses to migrate an anime to itself', async () => {
  const found = await invoke<{ items: { animeId: number; title: string }[] }>('sources.browse', {
    sourceId: 'example/en',
    kind: 'search',
    page: 1,
    query: 'Long Runner',
  });
  const longRunner = found.items[0]!.animeId;
  await invoke('anime.refresh', { animeId: longRunner });
  const sibling = await invoke<{ items: { animeId: number }[] }>('sources.browse', {
    sourceId: 'example/id',
    kind: 'search',
    page: 1,
    query: 'Long Runner',
  });
  const other = sibling.items[0]!.animeId;
  await invoke('library.add', { animeId: longRunner, categoryIds: [] });
  const episodes = await invoke<{ id: number; number: number }[]>('episodes.list', { animeId: longRunner });
  // Episode 120 exists on both sources; make one on the old side that the new side will not have.
  await invoke('episodes.markWatched', { episodeIds: [episodes.find((e) => e.number === 120)!.id], watched: true });
  await invoke('anime.refresh', { animeId: other });

  const preview = await invoke<{ withProgress: number; matched: number; unmatched: unknown[] }>(
    'library.migratePreview',
    { fromAnimeId: longRunner, toAnimeId: other },
  );
  expect(preview).toMatchObject({ withProgress: 1, matched: 1, unmatched: [] });
  await expect(invoke('library.migratePreview', { fromAnimeId: longRunner, toAnimeId: longRunner })).rejects.toThrow(
    /another anime/,
  );
});
