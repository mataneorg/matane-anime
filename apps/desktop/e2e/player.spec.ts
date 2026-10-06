import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 1, milestone 1d: stream selection, probing, fallback and the player, in the real app against the
// fake site (HLS over the anime:// proxy, hls.js, the extension host, the lot).

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

/** The id of an episode of a fake-catalog anime, found the way a user would: search, open, list. */
async function episodeId(title: string, number: number, variant?: string): Promise<number> {
  const found = await invoke<{ items: { animeId: number; title: string }[] }>('sources.browse', {
    sourceId: 'example/en',
    kind: 'search',
    page: 1,
    query: title,
  });
  const anime = found.items.find((item) => item.title === title);
  if (!anime) throw new Error(`No anime ${title}`);
  const { episodes } = await invoke<{ episodes: { id: number; number: number; variant: string | null }[] }>(
    'anime.refresh',
    { animeId: anime.animeId },
  );
  const episode = episodes.find((e) => e.number === number && (variant === undefined || e.variant === variant));
  if (!episode) throw new Error(`No episode ${number} of ${title}`);
  return episode.id;
}

const video = () => ({
  state: () =>
    page.locator('video').evaluate((element: HTMLVideoElement) => ({
      time: element.currentTime,
      paused: element.paused,
      width: element.videoWidth,
      frames: element.getVideoPlaybackQuality().totalVideoFrames,
      rate: element.playbackRate,
      volume: element.volume,
      src: element.currentSrc || element.src,
      ended: element.ended,
    })),
});
const waitPlaying = async (minTime = 0.8): Promise<void> => {
  await expect.poll(async () => (await video().state()).time, { timeout: 20_000 }).toBeGreaterThan(minTime);
};
const serverButton = () => page.getByRole('button', { name: /^Server [AB]/ });

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
test.beforeEach(async () => {
  site.reset();
  await go('#/library');
});

test('plays an HLS episode with real controls', async () => {
  const id = await episodeId('Sky Harbor', 1);
  await go(`#/watch/${id}`);
  await waitPlaying();
  const state = await video().state();
  expect(state.src).toMatch(/^blob:/); // hls.js over MSE
  expect(state.width).toBeGreaterThan(0);
  expect(state.frames).toBeGreaterThan(0);

  await expect(page.getByText('Sky Harbor', { exact: true })).toBeVisible();
  await expect(page.getByText(/Ep 1 · Episode 1 · Example Site \(EN\)/)).toBeVisible();
  await expect(serverButton()).toContainText('Server A · 720p'); // highest quality first
  await shot('player');

  // Keyboard: Space pauses and resumes, arrows seek, [ and ] change the speed, M mutes.
  await page.keyboard.press('Space');
  await expect.poll(async () => (await video().state()).paused).toBe(true);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const before = (await video().state()).time;
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await video().state()).time).toBeGreaterThan(before + 3);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await video().state()).paused).toBe(false);
  await page.keyboard.press(']');
  await expect.poll(async () => (await video().state()).rate).toBe(1.25);
  await page.keyboard.press('[');
  await expect.poll(async () => (await video().state()).rate).toBe(1);
});

test('remembers volume, mute and speed as settings', async () => {
  await go(`#/watch/${await episodeId('Sky Harbor', 1)}`);
  await waitPlaying();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(async () => (await invoke<{ playerVolume: number }>('settings.get')).playerVolume)
    .toBeCloseTo(0.9, 1);
  await page.keyboard.press(']');
  await expect.poll(async () => (await invoke<{ playerSpeed: number }>('settings.get')).playerSpeed).toBe(1.25);
  await page.keyboard.press('M');
  await expect.poll(async () => (await invoke<{ playerMuted: boolean }>('settings.get')).playerMuted).toBe(true);
  await invoke('settings.set', { playerVolume: 1, playerSpeed: 1, playerMuted: false });
});

test('switching server keeps the position, and the choice is remembered for the anime', async () => {
  const id = await episodeId('Sky Harbor', 2);
  await go(`#/watch/${id}`);
  await waitPlaying(1.2);
  await page.keyboard.press('Space'); // hold still so the position is easy to compare
  const paused = await video().state();

  await serverButton().click();
  const menu = page.getByRole('dialog', { name: 'Servers' });
  await expect(menu).toContainText('Server A');
  await expect(menu).toContainText('Server B');
  await expect(menu).toContainText('Playing');
  await shot('player-servers');
  await menu.getByRole('radio', { name: /Server B/ }).click();
  await expect(page.getByText('Switching to Server B')).toBeVisible();
  await expect(serverButton()).toContainText('Server B · 360p');
  await expect
    .poll(async () => (await video().state()).time, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(paused.time - 0.6);

  // Another time, this anime starts on the server that was picked by hand (STR-1, STR-5).
  await go('#/library');
  await go(`#/watch/${await episodeId('Sky Harbor', 1)}`);
  await waitPlaying();
  await expect(serverButton()).toContainText('Server B');
});

test('moves between episodes and offers the episode list', async () => {
  const first = await episodeId('Quiet Orchard', 1);
  const second = await episodeId('Quiet Orchard', 2);
  await go(`#/watch/${first}`);
  await waitPlaying();
  await expect(page.getByRole('button', { name: 'Previous episode' })).toBeDisabled();
  await page.getByRole('button', { name: 'Episodes', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Episodes' });
  await expect(panel.getByRole('button')).toHaveCount(3);
  await expect(panel.getByRole('button', { name: /Episode 1/ })).toHaveAttribute('aria-current', 'true');
  await panel.getByRole('button', { name: /Episode 2/ }).click();
  await expect(page).toHaveURL(new RegExp(`/watch/${second}$`));
  await waitPlaying();

  await page.keyboard.press('Shift+P');
  await expect(page).toHaveURL(new RegExp(`/watch/${first}$`));
  await waitPlaying();
  await page.getByRole('button', { name: 'Next episode' }).click();
  await expect(page).toHaveURL(new RegExp(`/watch/${second}$`));
  expect(await video().state()).toMatchObject({ width: expect.any(Number) });
});

test('counts down to the next episode and lets you cancel', async () => {
  const first = await episodeId('Quiet Orchard', 1);
  const second = await episodeId('Quiet Orchard', 2);
  await go(`#/watch/${first}`);
  await waitPlaying();
  await page.locator('video').evaluate((element: HTMLVideoElement) => {
    element.currentTime = element.duration - 0.4;
  });
  const overlay = page.getByRole('status').filter({ hasText: 'Next episode in' });
  await expect(overlay).toBeVisible({ timeout: 15_000 });
  await shot('player-autoplay');
  await overlay.getByRole('button', { name: 'Cancel' }).click();
  await expect(overlay).toHaveCount(0);
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(new RegExp(`/watch/${first}$`));

  // Let it run out this time.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.locator('video').evaluate((element: HTMLVideoElement) => {
    element.currentTime = element.duration - 0.4;
  });
  await expect(overlay).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(new RegExp(`/watch/${second}$`), { timeout: 12_000 });
});

test('an expired link is renewed once, and playback carries on (STR-4)', async () => {
  const id = await episodeId('Token Tide', 1);
  await go(`#/watch/${id}`);
  await waitPlaying(0.5);
  // The first link dies after its first segment; main asks the extension again and gets a working one.
  await expect.poll(async () => (await video().state()).time, { timeout: 25_000 }).toBeGreaterThan(3.5);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(site.log.filter((e) => e.path === '/embed/token-tide-1-sub.a')).toHaveLength(2);
  await expect(serverButton()).toContainText('Server A');
});

test('moves to the next server when one keeps failing (STR-3)', async () => {
  const id = await episodeId('Bad Server', 1);
  await go(`#/watch/${id}`);
  await expect(serverButton()).toContainText('Server A'); // ranked first: higher quality
  await expect(page.getByText('Switching to Server B')).toBeVisible({ timeout: 25_000 });
  await expect(serverButton()).toContainText('Server B');
  await expect.poll(async () => (await video().state()).time, { timeout: 20_000 }).toBeGreaterThan(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('when every server fails the player says so, with what was tried', async () => {
  const id = await episodeId('Expiring Tide', 1);
  await go(`#/watch/${id}`);
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible({ timeout: 40_000 });
  await expect(alert).toContainText('This stream has expired');
  await expect(alert).toContainText('Server A');
  await expect(alert).toContainText('Server B');
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(alert.getByRole('button', { name: 'Switch server' })).toBeVisible();
  await shot('player-error');
});

test('an episode with no streams is reported, not left spinning', async () => {
  const id = await episodeId('No Streams', 1);
  await go(`#/watch/${id}`);
  await expect(page.getByRole('alert')).toContainText('No server answered', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('Escape goes back, and the player settings are editable', async () => {
  await go('#/settings/player');
  await expect(page.getByRole('switch', { name: 'Play the next episode automatically' })).toBeChecked();
  await page.getByRole('switch', { name: 'Play the next episode automatically' }).click();
  await expect.poll(async () => (await invoke<{ playerAutoplay: boolean }>('settings.get')).playerAutoplay).toBe(false);
  await page.getByLabel('Preferred quality').selectOption('360');
  await expect.poll(async () => (await invoke<{ playerQuality: string }>('settings.get')).playerQuality).toBe('360');
  await shot('settings-player');

  const id = await episodeId('Sky Harbor', 1);
  await go(`#/watch/${id}`);
  await waitPlaying();
  // The server picked by hand for this anime earlier still wins over the quality preference (STR-1).
  await expect(serverButton()).toContainText('Server B · 360p');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/settings\/player$/);
  await invoke('settings.set', { playerAutoplay: true, playerQuality: 'highest' });
});
