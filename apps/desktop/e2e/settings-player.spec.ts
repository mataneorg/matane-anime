import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_SHORTCUTS, type ShortcutMap } from '@matane-anime/shared';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Settings → Player: the keyboard shortcut editor (PLY-3) and the autoplay countdown (PLY-4), driven from the
// settings page and then checked in the real player.

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
const shortcuts = async (): Promise<ShortcutMap> =>
  (await invoke<{ playerShortcuts: ShortcutMap }>('settings.get')).playerShortcuts;

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
const state = () =>
  page.locator('video').evaluate((element: HTMLVideoElement) => ({
    time: element.currentTime,
    paused: element.paused,
    muted: element.muted,
  }));
const waitPlaying = async (minTime = 0.8): Promise<void> => {
  await expect.poll(async () => (await state()).time, { timeout: 20_000 }).toBeGreaterThan(minTime);
};
const change = (action: string) => page.getByTestId(`shortcut-change-${action}`);
const row = (action: string) => page.getByTestId(`shortcut-${action}`);

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  site = await TestSite.start({ mediaDir: resolve(__dirname, 'fixtures/media') });
  execFileSync(process.execPath, [resolve(ROOT, 'packages/extension-cli/dist/cli.js'), 'build', EXAMPLE], {
    stdio: 'pipe',
  });
  ({ app, page, userData } = await launchApp());
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
  await app?.close().catch(() => undefined);
  await site?.close();
});
test.beforeEach(async () => {
  site.reset();
});

test.describe('keyboard shortcuts (PLY-3)', () => {
  test('lists the defaults, and Reset to defaults has nothing to do yet', async () => {
    await go('#/settings/player');
    await expect(row('play-pause')).toContainText('Space');
    await expect(row('play-pause')).toContainText('K');
    await expect(row('next')).toContainText('Shift N');
    await expect(row('back')).toContainText('←');
    expect(await shortcuts()).toEqual(DEFAULT_SHORTCUTS);
    await expect(page.getByTestId('shortcuts-reset')).toBeDisabled();
    await shot('settings-shortcuts');
  });

  test('a rebound key works in the player, and the old keys no longer do', async () => {
    await go('#/settings/player');
    await change('play-pause').click();
    await expect(row('play-pause').getByRole('status')).toHaveText('Press a key…');
    await page.keyboard.press('P');
    await expect(row('play-pause')).not.toContainText('Press a key');
    await expect(row('play-pause')).toContainText('P');
    await expect.poll(async () => (await shortcuts())['play-pause']).toEqual(['P']);
    await expect(page.getByTestId('shortcuts-reset')).toBeEnabled();
    // The other actions did not move.
    expect(await shortcuts()).toEqual({ ...DEFAULT_SHORTCUTS, 'play-pause': ['P'] });

    await go(`#/watch/${await episodeId('Sky Harbor', 1)}`);
    await waitPlaying();
    await page.keyboard.press('P');
    await expect.poll(async () => (await state()).paused).toBe(true);
    await page.keyboard.press('P');
    await expect.poll(async () => (await state()).paused).toBe(false);

    // Space and K used to pause; now they do nothing.
    await page.keyboard.press('Space');
    await page.keyboard.press('K');
    await page.waitForTimeout(800);
    expect((await state()).paused).toBe(false);
    // An action that was not changed still has its own key.
    await page.keyboard.press('M');
    await expect.poll(async () => (await state()).muted).toBe(true);
    await page.keyboard.press('M');
    await expect.poll(async () => (await state()).muted).toBe(false);
  });

  test('a key already used by another action is refused, and Esc cancels the recorder', async () => {
    await go('#/settings/player');
    const before = await shortcuts();
    await change('mute').click();
    await page.keyboard.press('F'); // Fullscreen's key
    const conflict = page.getByTestId('shortcut-conflict');
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText('F is already used for "Fullscreen"');
    await shot('settings-shortcuts-conflict');
    expect(await shortcuts()).toEqual(before);
    await expect(row('mute')).toContainText('M');

    await change('mute').click();
    await expect(conflict).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(row('mute').getByRole('status')).toHaveCount(0);
    expect(await shortcuts()).toEqual(before);
    await expect(page).toHaveURL(/settings\/player$/);

    // P belongs to Play or pause now.
    await change('mute').click();
    await page.keyboard.press('P');
    await expect(conflict).toContainText('P is already used for "Play or pause"');
    expect(await shortcuts()).toEqual(before);
  });

  test('a key freed by a change can be taken by another action, and the choice survives a restart', async () => {
    await go('#/settings/player');
    // Space left Play or pause in the first test, so Back can have it.
    await change('back').click();
    await page.keyboard.press('Space');
    await expect.poll(async () => (await shortcuts()).back).toEqual(['Space']);
    await expect(page.getByTestId('shortcut-conflict')).toHaveCount(0);

    await app.close();
    ({ app, page } = await launchApp({}, { userData }));
    await page.waitForSelector('nav', { timeout: 30_000 });
    expect(await shortcuts()).toEqual({ ...DEFAULT_SHORTCUTS, 'play-pause': ['P'], back: ['Space'] });
    await go('#/settings/player');
    await expect(row('back')).toContainText('Space');
  });

  test('Reset to defaults brings every key back', async () => {
    await go('#/settings/player');
    await page.getByTestId('shortcuts-reset').click();
    await expect.poll(shortcuts).toEqual(DEFAULT_SHORTCUTS);
    await expect(row('play-pause')).toContainText('Space');
    await expect(row('back')).toContainText('←');
    await expect(page.getByTestId('shortcuts-reset')).toBeDisabled();

    await go(`#/watch/${await episodeId('Sky Harbor', 1)}`);
    await waitPlaying();
    await page.keyboard.press('Space');
    await expect.poll(async () => (await state()).paused).toBe(true);
    await page.keyboard.press('K');
    await expect.poll(async () => (await state()).paused).toBe(false);
  });
});

test.describe('autoplay countdown (PLY-4)', () => {
  test('defaults to 5 seconds, and the choice is the one the player counts', async () => {
    await go('#/settings/player');
    const countdown = page.getByLabel('Countdown');
    await expect(countdown).toHaveValue('5');
    await countdown.selectOption('3');
    await expect
      .poll(async () => (await invoke<{ playerAutoplayCountdown: number }>('settings.get')).playerAutoplayCountdown)
      .toBe(3);
    await shot('settings-countdown');

    const first = await episodeId('Quiet Orchard', 1);
    const second = await episodeId('Quiet Orchard', 2);
    await go(`#/watch/${first}`);
    await waitPlaying();
    await page.locator('video').evaluate((element: HTMLVideoElement) => {
      element.currentTime = element.duration - 0.4;
    });
    const overlay = page.getByRole('status').filter({ hasText: 'Next episode in' });
    await expect(overlay).toContainText('Next episode in 3 seconds', { timeout: 15_000 });
    const shown = Date.now();
    await expect(page).toHaveURL(new RegExp(`/watch/${second}$`), { timeout: 12_000 });
    // Three seconds of countdown, not five.
    expect(Date.now() - shown).toBeLessThan(4600);
  });

  test('10 seconds counts down from 10, and Cancel still stops it', async () => {
    await invoke('settings.set', { playerAutoplayCountdown: 10 });
    const first = await episodeId('Quiet Orchard', 1);
    await go(`#/watch/${first}`);
    await waitPlaying();
    await page.locator('video').evaluate((element: HTMLVideoElement) => {
      element.currentTime = element.duration - 0.4;
    });
    const overlay = page.getByRole('status').filter({ hasText: 'Next episode in' });
    await expect(overlay).toContainText('Next episode in 10 seconds', { timeout: 15_000 });
    await overlay.getByRole('button', { name: 'Cancel' }).click();
    await expect(overlay).toHaveCount(0);
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(new RegExp(`/watch/${first}$`));
    await invoke('settings.set', { playerAutoplayCountdown: 5 });
  });

  test('the countdown select is off while autoplay is off', async () => {
    await go('#/settings/player');
    await page.getByRole('switch', { name: 'Play the next episode automatically' }).click();
    await expect(page.getByLabel('Countdown')).toBeDisabled();
    await page.getByRole('switch', { name: 'Play the next episode automatically' }).click();
    await expect(page.getByLabel('Countdown')).toBeEnabled();
  });
});
