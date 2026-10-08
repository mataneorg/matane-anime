import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 3, milestone 3c: a downloaded episode plays from disk with the site gone (STR-7, DL-14), also after
// the app restarts, and when its files are deleted the next start streams again and says what happened.

const ROOT = resolve(__dirname, '../../..');
const EXAMPLE = resolve(ROOT, 'extensions/example');

test.describe.configure({ mode: 'serial' });

let site: TestSite;
let app: ElectronApplication;
let page: Page;
let userData: string;
let folder: string;

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

interface Row {
  episodeId: number;
  status: string;
  error: string | null;
  kind: 'hls' | 'mp4';
}

async function episodeId(title: string, number: number): Promise<number> {
  const found = await invoke<{ items: { animeId: number; title: string }[] }>('sources.browse', {
    sourceId: 'example/en',
    kind: 'search',
    page: 1,
    query: title,
  });
  const anime = found.items.find((item) => item.title === title);
  if (!anime) throw new Error(`No anime ${title}`);
  const { episodes } = await invoke<{ episodes: { id: number; number: number }[] }>('anime.refresh', {
    animeId: anime.animeId,
  });
  const episode = episodes.find((e) => e.number === number);
  if (!episode) throw new Error(`No episode ${number} of ${title}`);
  return episode.id;
}

const row = async (id: number): Promise<Row | undefined> =>
  (await invoke<Row[]>('downloads.list')).find((item) => item.episodeId === id);

/** Downloads an episode through the app and waits until it is `done`. */
async function download(title: string): Promise<number> {
  const id = await episodeId(title, 1);
  const result = await invoke<{ queued: number[]; refused: unknown[] }>('downloads.enqueue', { episodeIds: [id] });
  expect(result.queued).toEqual([id]);
  await expect.poll(async () => (await row(id))?.status, { timeout: 60_000 }).toBe('done');
  return id;
}

const state = () =>
  page.locator('video').evaluate((v: HTMLVideoElement) => ({
    time: v.currentTime,
    duration: v.duration,
    width: v.videoWidth,
    src: v.currentSrc || v.src,
  }));
const waitPlaying = (minTime = 0.8) =>
  expect.poll(async () => (await state()).time, { timeout: 20_000 }).toBeGreaterThan(minTime);

/** Every file below `root`, absolute. */
function files(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** Opens the player on an episode and checks that it plays from disk without a single request to the site. */
async function playFromDisk(id: number): Promise<void> {
  site.reset();
  await go(`#/watch/${id}`);
  await waitPlaying();
  expect((await state()).width).toBeGreaterThan(0);
  expect(site.log).toHaveLength(0);
  await page.keyboard.press('Escape');
}

async function ready(): Promise<void> {
  await page.waitForSelector('nav', { timeout: 30_000 });
  await expect
    .poll(async () => (await invoke<{ id: string }[]>('sources.list')).map((s) => s.id), { timeout: 20_000 })
    .toContain('example/en');
}

test.beforeAll(async () => {
  site = await TestSite.start({ mediaDir: resolve(__dirname, 'fixtures/media') });
  execFileSync(process.execPath, [resolve(ROOT, 'packages/extension-cli/dist/cli.js'), 'build', EXAMPLE], {
    stdio: 'pipe',
  });
  folder = mkdtempSync(join(tmpdir(), 'matane-offline-'));
  ({ app, page, userData } = await launchApp());
  await page.waitForSelector('nav', { timeout: 30_000 });
  await invoke('extensions.loadDevFolder', { folder: EXAMPLE });
  await invoke('extensions.setPreference', { extensionId: 'example', key: 'baseUrl', value: site.origin });
  await invoke('settings.set', { downloadFolder: folder });
});
test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  await site?.close();
  rmSync(folder, { recursive: true, force: true });
});

test('HLS downloads (plain, AES-128 and with a separate audio track) play with the site shut down', async () => {
  test.setTimeout(240_000);
  for (const title of ['Sky Harbor', 'Cipher Coast', 'Two Tracks']) {
    const id = await download(title);
    await site.stop();
    try {
      await playFromDisk(id);
    } finally {
      await site.resume();
    }
    // With the site back, the episode still comes from disk: not one request goes out.
    await playFromDisk(id);
  }
});

test('an MP4 download plays offline, seeks, and still plays after the app is restarted', async () => {
  test.setTimeout(120_000);
  const id = await download('Quiet Orchard');
  await site.stop();
  await go(`#/watch/${id}`);
  await waitPlaying();
  const { duration } = await state();
  expect(duration).toBeGreaterThan(5);
  const target = Math.floor(duration / 2);
  await page.locator('video').evaluate((v: HTMLVideoElement, t) => {
    v.currentTime = t;
  }, target);
  await expect.poll(async () => (await state()).time, { timeout: 15_000 }).toBeGreaterThan(target + 0.5);
  await page.keyboard.press('Escape');

  // The site is still down: close the app and open it on the same profile.
  await app.close();
  ({ app, page } = await launchApp({}, { userData }));
  await ready();
  site.reset();
  await go(`#/watch/${id}`);
  await waitPlaying();
  expect(site.log).toHaveLength(0);
  await page.keyboard.press('Escape');
  await site.resume();
});

test('deleting the files makes the next start stream again and the download says file_missing', async () => {
  const id = await episodeId('Quiet Orchard', 1);
  const mp4 = files(folder).find((path) => path.endsWith('.mp4'));
  expect(mp4).toBeDefined();
  rmSync(mp4 as string);

  const session = await invoke<{ playbackId: string; streams: { server: string }[]; url: string }>('playback.start', {
    episodeId: id,
  });
  expect(session.streams[0]?.server).not.toBe('Downloaded');
  await invoke('playback.close', { playbackId: session.playbackId });
  expect(await row(id)).toMatchObject({ status: 'error', error: 'file_missing' });

  // An HLS download loses only its playlist's folder: same outcome, and the player streams.
  const hlsId = await episodeId('Sky Harbor', 1);
  const playlist = files(folder).find((path) => path.includes('Sky Harbor') && path.endsWith('playlist.m3u8'));
  expect(playlist).toBeDefined();
  rmSync(dirname(playlist as string), { recursive: true });
  await go(`#/watch/${hlsId}`);
  await waitPlaying();
  expect((await state()).src).toMatch(/^blob:/);
  expect(site.log.length).toBeGreaterThan(0);
  expect(await row(hlsId)).toMatchObject({ status: 'error', error: 'file_missing' });
});
