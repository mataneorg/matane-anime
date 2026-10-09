import type { UpdateChannel } from '@matane-anime/shared';

// Self-update through electron-updater against GitHub Releases. This is the only traffic the app sends
// besides the sources: no telemetry (docs/PRD.md §10.3). Nothing here runs in development.

/** Where release pages live. Keep it in sync with `publish` in electron-builder.yml. */
export const RELEASES_URL = 'https://github.com/mataneorg/matane-anime/releases';

/** Shortly after start, so the check does not compete with the window and the library loading. */
export const FIRST_CHECK_DELAY_MS = 15_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdaterState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

export interface UpdaterStatus {
  state: UpdaterState;
  /** The version found, once `state` is past `checking`. */
  version?: string;
  /** Release page: what the UI opens when the update cannot be installed by the app (macOS, R13). */
  url?: string;
  /** Download progress, 0–100, while `downloading`. */
  percent?: number;
  /** What went wrong, when `state` is `error`. */
  message?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- electron-updater's event payloads differ per event
type Listener = (...args: any[]) => void;

/** The part of electron-updater's `AppUpdater` that is used here, so tests can pass a fake. */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  channel: string | null;
  logger: unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: string, listener: Listener): unknown;
  removeListener(event: string, listener: Listener): unknown;
}

export interface UpdaterLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface AppUpdaterDeps {
  app: { isPackaged: boolean };
  /** Called once, on `start()` in a packaged app: `electron-updater` is not loaded otherwise. */
  getAutoUpdater: () => AutoUpdaterLike;
  /** Read before every check, so a change in Settings applies without a restart. */
  getChannel: () => UpdateChannel;
  logger: UpdaterLogger;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  timers?: Timers;
}

const IDLE: UpdaterStatus = { state: 'idle' };

/** electron-updater's errors carry whole HTTP responses (headers, cookies); the first line says what happened. */
function brief(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return (text.split('\n')[0] ?? '').trim().slice(0, 300);
}

/**
 * Whether the app can replace itself. macOS needs a signed build (R13), and a Linux build can only update
 * as an AppImage. Everywhere else the update is only announced, with a link to the release.
 */
export function canInstallUpdates(platform: NodeJS.Platform, env: Record<string, string | undefined>): boolean {
  if (platform === 'darwin') return false;
  if (platform === 'linux') return Boolean(env['APPIMAGE']);
  // The Windows portable build (electron-builder sets this variable) is not installed, so an NSIS update
  // cannot replace it: it only announces the new version.
  if (platform === 'win32' && env['PORTABLE_EXECUTABLE_FILE']) return false;
  return true;
}

export class AppUpdater {
  private readonly listeners = new Set<(status: UpdaterStatus) => void>();
  private readonly timers: Timers;
  private readonly platform: NodeJS.Platform;
  private readonly installable: boolean;
  private updater: AutoUpdaterLike | null = null;
  private current: UpdaterStatus = IDLE;
  private firstCheck: unknown;
  private interval: unknown;
  private detach: (() => void) | null = null;

  constructor(private readonly deps: AppUpdaterDeps) {
    this.timers = deps.timers ?? {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
      setInterval: (callback, ms) => setInterval(callback, ms),
      clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
    };
    this.platform = deps.platform ?? process.platform;
    this.installable = canInstallUpdates(this.platform, deps.env ?? process.env);
  }

  get status(): UpdaterStatus {
    return this.current;
  }

  /** Whether `ready` can be applied with `quitAndInstall()`; otherwise the UI points at `url`. */
  get canInstall(): boolean {
    return this.installable;
  }

  onStatus(listener: (status: UpdaterStatus) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Checks once shortly after start and then every 6 hours. A no-op unless the app is packaged. */
  start(): void {
    if (!this.deps.app.isPackaged || this.updater) return;
    try {
      this.updater = this.deps.getAutoUpdater();
      this.configure(this.updater);
    } catch (error) {
      this.updater = null;
      this.fail(error);
      return;
    }
    this.firstCheck = this.timers.setTimeout(() => void this.checkNow(), FIRST_CHECK_DELAY_MS);
    this.interval = this.timers.setInterval(() => void this.checkNow(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    this.timers.clearTimeout(this.firstCheck);
    this.timers.clearInterval(this.interval);
    this.firstCheck = undefined;
    this.interval = undefined;
    this.detach?.();
    this.detach = null;
    this.updater = null;
  }

  /** Asks GitHub for a newer release. Never throws: a failure becomes the `error` status. */
  async checkNow(): Promise<UpdaterStatus> {
    const updater = this.updater;
    if (!updater) return this.current;
    // A check or a download is already running, or the update is waiting for a restart.
    if (['checking', 'downloading', 'ready'].includes(this.current.state)) return this.current;
    try {
      this.applyChannel(updater);
      this.set({ state: 'checking' });
      await updater.checkForUpdates();
      // electron-updater answers with an event; if it did not (it returns null when inactive), the check is over.
      if (this.current.state === 'checking') this.set(IDLE);
    } catch (error) {
      this.fail(error);
    }
    return this.current;
  }

  /** Restarts into the downloaded update. Only meaningful when `status.state` is `ready`. */
  quitAndInstall(): void {
    if (this.current.state === 'ready' && this.installable) this.updater?.quitAndInstall();
  }

  private configure(updater: AutoUpdaterLike): void {
    const { logger } = this.deps;
    updater.logger = {
      info: (message: unknown) => logger.info(brief(message)),
      warn: (message: unknown) => logger.warn(brief(message)),
      error: (message: unknown) => logger.error(brief(message)),
      debug: () => undefined,
    };
    // Download in the background and install when the app quits, only where the app can replace itself.
    updater.autoDownload = this.installable;
    updater.autoInstallOnAppQuit = this.installable;
    // Moving from beta back to stable never downgrades: the user keeps the build until stable catches up.
    updater.allowDowngrade = false;

    const handlers: [string, Listener][] = [
      ['update-available', (info: { version: string }) => this.found(info.version)],
      ['update-not-available', () => this.set(IDLE)],
      ['download-progress', (progress: { percent: number }) => this.progress(progress.percent)],
      ['update-downloaded', (info: { version: string }) => this.downloaded(info.version)],
      ['error', (error: unknown) => this.fail(error)],
    ];
    for (const [event, listener] of handlers) updater.on(event, listener);
    this.detach = () => {
      for (const [event, listener] of handlers) updater.removeListener(event, listener);
    };
  }

  private applyChannel(updater: AutoUpdaterLike): void {
    const beta = this.deps.getChannel() === 'beta';
    updater.allowPrerelease = beta;
    updater.channel = beta ? 'beta' : 'latest';
  }

  private found(version: string): void {
    const url = `${RELEASES_URL}/tag/v${version}`;
    if (this.installable) {
      this.deps.logger.info(`update ${version} found, downloading`);
      this.set({ state: 'downloading', version, url, percent: 0 });
    } else {
      this.deps.logger.info(`update ${version} found, this build cannot install it: notify only`);
      this.set({ state: 'available', version, url });
    }
  }

  private progress(percent: number): void {
    const { version, url } = this.current;
    this.set({ state: 'downloading', ...(version && { version }), ...(url && { url }), percent: Math.round(percent) });
  }

  private downloaded(version: string): void {
    this.deps.logger.info(`update ${version} downloaded, it installs when the app quits`);
    this.set({ state: 'ready', version, url: `${RELEASES_URL}/tag/v${version}` });
  }

  private fail(error: unknown): void {
    const message = brief(error);
    // electron-updater emits `error` and also rejects the check: say it once.
    if (this.current.state !== 'error' || this.current.message !== message) {
      this.deps.logger.warn(`update check failed: ${message}`);
    }
    this.set({ state: 'error', message });
  }

  private set(status: UpdaterStatus): void {
    if (JSON.stringify(status) === JSON.stringify(this.current)) return;
    this.current = status;
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (error) {
        this.deps.logger.error('updater listener failed', error);
      }
    }
  }
}
