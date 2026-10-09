import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 5, milestone 5h: what the phase added, through the real IPC and the real window: the first-run flow,
// incognito, the network settings, the command palette, and a backup that is restored after a restart.
// Written at the office without running Electron: run it at home with `xvfb-run -a pnpm e2e e2e/phase5.spec.ts`.

const ROOT = resolve(__dirname, '../../..');
const EXAMPLE = resolve(ROOT, 'extensions/example');
const DURATION = 1_440_000;

test.describe.configure({ mode: 'serial' });

let site: TestSite;
let app: ElectronApplication;
let page: Page;
let userData: string;
let animeId = 0;
let firstEpisode = 0;

const invokeOn = <T = unknown>(target: Page, channel: string, input?: unknown): Promise<T> =>
  target.evaluate(
    ([c, i]) =>
      (window as unknown as { api: { invoke(c: string, i?: unknown): Promise<unknown> } }).api.invoke(c as string, i),
    [channel, input] as const,
  ) as Promise<T>;
const invoke = <T = unknown>(channel: string, input?: unknown): Promise<T> => invokeOn<T>(page, channel, input);

async function start(): Promise<void> {
  ({ app, page, userData } = await launchApp({}, userData ? { userData } : {}));
  await page.waitForSelector('nav', { timeout: 30_000 });
}

test.beforeAll(async () => {
  site = await TestSite.start({ mediaDir: resolve(__dirname, 'fixtures/media') });
  execFileSync(process.execPath, [resolve(ROOT, 'packages/extension-cli/dist/cli.js'), 'build', EXAMPLE], {
    stdio: 'pipe',
  });
  await start();
  await invoke('extensions.loadDevFolder', { folder: EXAMPLE });
  await invoke('extensions.setPreference', { extensionId: 'example', key: 'baseUrl', value: site.origin });
});
test.afterAll(async () => {
  await app?.close();
  await site?.close();
});

test('a fresh profile starts with onboarding, and skipping it is remembered', async () => {
  const fresh = await launchApp({}, { onboarding: true });
  try {
    await expect(fresh.page.getByText('Skip setup')).toBeVisible({ timeout: 30_000 });
    expect((await invokeOn<{ onboardingDone: boolean }>(fresh.page, 'settings.get')).onboardingDone).toBe(false);
    await fresh.page.getByText('Skip setup').click();
    await expect
      .poll(async () => (await invokeOn<{ onboardingDone: boolean }>(fresh.page, 'settings.get')).onboardingDone)
      .toBe(true);
    await expect(fresh.page.getByText('Skip setup')).toHaveCount(0);
  } finally {
    await fresh.app.close();
  }
});

test('the command palette opens with Ctrl+K and closes with Escape', async () => {
  await page.keyboard.press('Control+K');
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible();
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
});

test('adds an anime to the library', async () => {
  const found = await invoke<{ items: { animeId: number }[] }>('sources.browse', {
    sourceId: 'example/en',
    kind: 'search',
    page: 1,
    query: 'Sky Harbor',
  });
  animeId = found.items[0]!.animeId;
  const { episodes } = await invoke<{ episodes: { id: number; number: number }[] }>('anime.refresh', { animeId });
  firstEpisode = episodes.find((e) => e.number === 1)!.id;
  await invoke('library.add', { animeId, categoryIds: [] });
});

test('incognito: nothing is recorded while it is on, and the pill shows', async () => {
  const send = (reason: string, positionMs: number, playbackId: string) =>
    invoke('watch.progress', { playbackId, episodeId: firstEpisode, positionMs, durationMs: DURATION, reason });
  const history = () => invoke<{ animeId: number }[]>('history.list');

  expect(await invoke('incognito.get')).toBe(false);
  expect(await invoke('incognito.set', true)).toBe(true);
  await expect(page.getByRole('button', { name: /Incognito is on/ })).toBeVisible();

  await send('play', 0, 'e2e-incognito');
  await new Promise((resolve) => setTimeout(resolve, 5300));
  await send('heartbeat', 200_000, 'e2e-incognito');
  await send('pause', 200_000, 'e2e-incognito');
  expect(await history()).toEqual([]);

  // Explicit actions still apply while it is on.
  await invoke('episodes.markWatched', { episodeIds: [firstEpisode], watched: true });
  await invoke('episodes.markWatched', { episodeIds: [firstEpisode], watched: false });

  expect(await invoke('incognito.set', false)).toBe(false);
  await expect(page.getByRole('button', { name: /Incognito is on/ })).toHaveCount(0);
  await send('play', 0, 'e2e-normal');
  await new Promise((resolve) => setTimeout(resolve, 5300));
  await send('heartbeat', 200_000, 'e2e-normal');
  await send('pause', 200_000, 'e2e-normal');
  expect((await history()).map((entry) => entry.animeId)).toEqual([animeId]);
});

test('network: the connection test uses the unsaved form values, and the proxy password never comes back', async () => {
  // Nothing listens on port 1, so a proxy there fails at once and without touching the internet.
  const result = await invoke<{ ok: boolean; ms: number | null; error: string | null }>('network.testConnection', {
    settings: { proxyMode: 'http', proxyHost: '127.0.0.1', proxyPort: 1 },
  });
  expect(result.ok).toBe(false);
  expect(result.ms).toBeNull();
  expect(result.error).toEqual(expect.any(String));
  // The saved settings were not touched by the test.
  expect(await invoke<{ proxyMode: string }>('settings.get')).toMatchObject({ proxyMode: 'system' });

  const info = await invoke<{ stored: boolean; encrypted: boolean }>('network.setProxyPassword', {
    password: 's3cret',
  });
  expect(info.stored).toBe(true);
  expect(JSON.stringify(await invoke('settings.get'))).not.toContain('s3cret');
  expect(JSON.stringify(info)).not.toContain('s3cret');
  expect((await invoke<{ stored: boolean }>('network.setProxyPassword', { password: null })).stored).toBe(false);
});

test('backup: export, restore after a restart, and the library is back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'matane-anime-backup-'));
  const file = join(dir, 'backup.zip');
  // The native dialogs cannot be driven, so answer them from main.
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, file);

  expect(await invoke<{ path: string }>('backup.export')).toEqual({ path: file });
  expect(existsSync(file)).toBe(true);

  const preview = await invoke<{ token: string; manifest: { counts: { anime: number } } }>('backup.peek');
  expect(preview.manifest.counts.anime).toBeGreaterThanOrEqual(1);

  // Lose the data the backup holds, then restore it: the app relaunches itself.
  await invoke('library.remove', { animeId });
  await invoke('history.clear');
  expect(await invoke<unknown[]>('library.list', { sort: 'title' })).toEqual([]);

  const closed = app.waitForEvent('close', { timeout: 60_000 });
  await invoke('backup.import', { token: preview.token });
  await closed;

  // A relaunched app is a new process: attach to the same profile.
  await start();
  await expect
    .poll(async () => (await invoke<{ animeId: number }[]>('library.list', { sort: 'title' })).map((i) => i.animeId), {
      timeout: 30_000,
    })
    .toEqual([animeId]);
  expect(readdirSync(join(userData, 'backups', 'db')).some((name) => name.startsWith('pre-restore-'))).toBe(true);
  expect(existsSync(join(userData, 'restore-failed'))).toBe(false);
});
