import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  AppUpdater,
  type AutoUpdaterLike,
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  RELEASES_URL,
  type Timers,
  type UpdaterStatus,
  canInstallUpdates,
} from './updater';

class FakeAutoUpdater extends EventEmitter implements AutoUpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = false;
  allowDowngrade = true;
  channel: string | null = null;
  logger: unknown = null;
  checks = 0;
  installs = 0;
  /** What `checkForUpdates` does; tests replace it to emit events or fail. */
  onCheck: (self: FakeAutoUpdater) => void | Promise<void> = () => undefined;
  async checkForUpdates(): Promise<unknown> {
    this.checks++;
    await this.onCheck(this);
    return null;
  }
  quitAndInstall(): void {
    this.installs++;
  }
}

class FakeTimers implements Timers {
  timeouts: { callback: () => void; ms: number; cleared: boolean }[] = [];
  intervals: { callback: () => void; ms: number; cleared: boolean }[] = [];
  setTimeout(callback: () => void, ms: number) {
    const timer = { callback, ms, cleared: false };
    this.timeouts.push(timer);
    return timer;
  }
  clearTimeout(handle: unknown) {
    if (handle) (handle as { cleared: boolean }).cleared = true;
  }
  setInterval(callback: () => void, ms: number) {
    const timer = { callback, ms, cleared: false };
    this.intervals.push(timer);
    return timer;
  }
  clearInterval(handle: unknown) {
    if (handle) (handle as { cleared: boolean }).cleared = true;
  }
}

function setup(
  overrides: {
    packaged?: boolean;
    channel?: 'stable' | 'beta';
    platform?: NodeJS.Platform;
    env?: Record<string, string | undefined>;
  } = {},
) {
  const auto = new FakeAutoUpdater();
  const timers = new FakeTimers();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let channel = overrides.channel ?? 'beta';
  const getAutoUpdater = vi.fn(() => auto);
  const updater = new AppUpdater({
    app: { isPackaged: overrides.packaged ?? true },
    getAutoUpdater,
    getChannel: () => channel,
    logger,
    platform: overrides.platform ?? 'win32',
    env: overrides.env ?? {},
    timers,
  });
  const seen: UpdaterStatus[] = [];
  updater.onStatus((status) => seen.push(status));
  return {
    auto,
    timers,
    logger,
    updater,
    seen,
    getAutoUpdater,
    setChannel: (value: 'stable' | 'beta') => (channel = value),
  };
}

describe('canInstallUpdates', () => {
  it('only installs where the app can replace itself', () => {
    expect(canInstallUpdates('win32', {})).toBe(true);
    expect(canInstallUpdates('win32', { PORTABLE_EXECUTABLE_FILE: 'C:\\Matane.exe' })).toBe(false);
    expect(canInstallUpdates('linux', { APPIMAGE: '/tmp/Matane.AppImage' })).toBe(true);
    expect(canInstallUpdates('linux', {})).toBe(false);
    expect(canInstallUpdates('darwin', {})).toBe(false);
  });
});

describe('AppUpdater when the app is not packaged', () => {
  it('does nothing: no electron-updater, no timers, no checks', async () => {
    const { updater, getAutoUpdater, timers, auto } = setup({ packaged: false });
    updater.start();
    expect(getAutoUpdater).not.toHaveBeenCalled();
    expect(timers.timeouts).toHaveLength(0);
    expect(timers.intervals).toHaveLength(0);
    expect(await updater.checkNow()).toEqual({ state: 'idle' });
    expect(auto.checks).toBe(0);
  });
});

describe('AppUpdater schedule and channel', () => {
  it('checks shortly after start and then every 6 hours', async () => {
    const { updater, timers, auto } = setup();
    updater.start();
    expect(timers.timeouts[0]?.ms).toBe(FIRST_CHECK_DELAY_MS);
    expect(timers.intervals[0]?.ms).toBe(CHECK_INTERVAL_MS);
    expect(CHECK_INTERVAL_MS).toBe(21_600_000);
    timers.timeouts[0]?.callback();
    await vi.waitFor(() => expect(updater.status.state).toBe('idle'));
    expect(auto.checks).toBe(1);
    timers.intervals[0]?.callback();
    await vi.waitFor(() => expect(auto.checks).toBe(2));
  });

  it('picks prereleases on the beta channel and only stable releases on stable', async () => {
    const { updater, auto, setChannel } = setup({ channel: 'beta' });
    updater.start();
    await updater.checkNow();
    expect([auto.allowPrerelease, auto.channel]).toEqual([true, 'beta']);
    setChannel('stable');
    await updater.checkNow();
    expect([auto.allowPrerelease, auto.channel]).toEqual([false, 'latest']);
    expect(auto.allowDowngrade).toBe(false);
  });

  it('stop() clears the timers and detaches from electron-updater', () => {
    const { updater, timers, auto } = setup();
    updater.start();
    expect(auto.listenerCount('error')).toBe(1);
    updater.stop();
    expect(timers.timeouts[0]?.cleared).toBe(true);
    expect(timers.intervals[0]?.cleared).toBe(true);
    expect(auto.listenerCount('error')).toBe(0);
  });
});

describe('AppUpdater where the app can install (Windows, AppImage)', () => {
  it('downloads automatically, reports progress and becomes ready', async () => {
    const { updater, auto, seen } = setup();
    auto.onCheck = (self) => {
      self.emit('update-available', { version: '0.1.0-beta.2' });
      self.emit('download-progress', { percent: 41.6 });
      self.emit('update-downloaded', { version: '0.1.0-beta.2' });
    };
    updater.start();
    expect(auto.autoDownload).toBe(true);
    expect(auto.autoInstallOnAppQuit).toBe(true);
    const url = `${RELEASES_URL}/tag/v0.1.0-beta.2`;
    expect(await updater.checkNow()).toEqual({ state: 'ready', version: '0.1.0-beta.2', url });
    expect(seen.map((s) => s.state)).toEqual(['checking', 'downloading', 'downloading', 'ready']);
    expect(seen[2]).toMatchObject({ percent: 42, version: '0.1.0-beta.2' });
    updater.quitAndInstall();
    expect(auto.installs).toBe(1);
  });

  it('works for a Linux AppImage and goes back to idle when there is nothing newer', async () => {
    const { updater, auto } = setup({ platform: 'linux', env: { APPIMAGE: '/x.AppImage' } });
    auto.onCheck = (self) => void self.emit('update-not-available', {});
    updater.start();
    expect(auto.autoDownload).toBe(true);
    expect(await updater.checkNow()).toEqual({ state: 'idle' });
  });

  it('does not start a second check while one is running or an update is ready', async () => {
    const { updater, auto } = setup();
    let release: () => void = () => undefined;
    auto.onCheck = () => new Promise<void>((resolve) => (release = resolve));
    updater.start();
    const first = updater.checkNow();
    await updater.checkNow();
    expect(auto.checks).toBe(1);
    release();
    await first;
    auto.emit('update-downloaded', { version: '1.0.0' });
    await updater.checkNow();
    expect(auto.checks).toBe(1);
  });
});

describe('AppUpdater on macOS and other builds that cannot install (R13)', () => {
  it.each([
    ['macOS', 'darwin' as const, {}],
    ['a Linux build outside an AppImage', 'linux' as const, {}],
  ])('only announces the update on %s', async (_name, platform, env) => {
    const { updater, auto } = setup({ platform, env });
    auto.onCheck = (self) => void self.emit('update-available', { version: '0.2.0' });
    updater.start();
    expect(auto.autoDownload).toBe(false);
    expect(auto.autoInstallOnAppQuit).toBe(false);
    expect(await updater.checkNow()).toEqual({
      state: 'available',
      version: '0.2.0',
      url: `${RELEASES_URL}/tag/v0.2.0`,
    });
    updater.quitAndInstall();
    expect(auto.installs).toBe(0);
  });
});

describe('AppUpdater failures', () => {
  it('turns a rejected check into the error status instead of throwing', async () => {
    const { updater, auto, logger } = setup();
    auto.onCheck = () => Promise.reject(new Error('getaddrinfo ENOTFOUND github.com'));
    updater.start();
    expect(await updater.checkNow()).toEqual({ state: 'error', message: 'getaddrinfo ENOTFOUND github.com' });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('keeps only the first line of electron-updater errors, which carry whole HTTP responses', async () => {
    const { updater, auto, logger } = setup();
    auto.onCheck = () =>
      Promise.reject(new Error('404 \n"method: GET url: https://github.com/x/y/releases.atom"\nHeaders: {...}'));
    updater.start();
    expect(await updater.checkNow()).toEqual({ state: 'error', message: '404' });
    (auto.logger as { error(message: unknown): void }).error(new Error('boom\nset-cookie: secret'));
    expect(logger.error).toHaveBeenCalledWith('boom');
  });

  it('survives the error event electron-updater emits next to the rejection, and the next check recovers', async () => {
    const { updater, auto, seen } = setup();
    auto.onCheck = (self) => {
      const error = new Error('404');
      self.emit('error', error);
      throw error;
    };
    updater.start();
    await updater.checkNow();
    expect(seen.filter((s) => s.state === 'error')).toHaveLength(1);
    auto.onCheck = (self) => void self.emit('update-not-available', {});
    expect(await updater.checkNow()).toEqual({ state: 'idle' });
  });

  it('does not crash when electron-updater cannot be loaded or a listener throws', async () => {
    const auto = new FakeAutoUpdater();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const broken = new AppUpdater({
      app: { isPackaged: true },
      getAutoUpdater: () => {
        throw new Error('no updater for this platform');
      },
      getChannel: () => 'beta',
      logger,
      timers: new FakeTimers(),
    });
    expect(() => broken.start()).not.toThrow();
    expect(broken.status.state).toBe('error');

    const ok = new AppUpdater({
      app: { isPackaged: true },
      getAutoUpdater: () => auto,
      getChannel: () => 'beta',
      logger,
      platform: 'win32',
      env: {},
      timers: new FakeTimers(),
    });
    ok.onStatus(() => {
      throw new Error('listener bug');
    });
    ok.start();
    await expect(ok.checkNow()).resolves.toBeDefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
