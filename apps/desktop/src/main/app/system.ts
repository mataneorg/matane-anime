// The desktop-integration rules as plain logic, so they test without Electron (docs/PRD.md UPD-9, R14): which
// menu the tray shows, whether closing the window hides it, and whether a start at login shows the window.
// The Linux tray is unreliable, so nothing here may depend on it: every decision falls back to normal behaviour.

import type { Language } from '@matane-anime/shared';

/** Passed by the login item (or autostart entry) so a start with the computer does not open the window. */
export const HIDDEN_ARG = '--hidden';

export const startedHidden = (argv: readonly string[]): boolean => argv.includes(HIDDEN_ARG);

export type TrayAction = 'open' | 'check' | 'toggleDownloads' | 'quit';

export type TrayMenuItem = { type: 'item'; id: TrayAction; label: string } | { type: 'separator' };

export interface TrayText {
  tooltip: string;
  open: string;
  check: string;
  pause: string;
  resume: string;
  quit: string;
}

// TODO: like `updates/messages.ts`, duplicated from the renderer catalogs until main gets its own i18n.
export function trayText(language: Language): TrayText {
  if (language === 'id') {
    return {
      tooltip: 'Matane Anime',
      open: 'Buka Matane Anime',
      check: 'Cek pembaruan sekarang',
      pause: 'Jeda unduhan',
      resume: 'Lanjutkan unduhan',
      quit: 'Keluar',
    };
  }
  return {
    tooltip: 'Matane Anime',
    open: 'Open Matane Anime',
    check: 'Check for updates now',
    pause: 'Pause downloads',
    resume: 'Resume downloads',
    quit: 'Quit',
  };
}

export function trayMenuModel(text: TrayText, downloadsPaused: boolean): TrayMenuItem[] {
  return [
    { type: 'item', id: 'open', label: text.open },
    { type: 'item', id: 'check', label: text.check },
    { type: 'item', id: 'toggleDownloads', label: downloadsPaused ? text.resume : text.pause },
    { type: 'separator' },
    { type: 'item', id: 'quit', label: text.quit },
  ];
}

/** Closing the window hides it only with the setting on, a tray that was created, and no quit under way. */
export function shouldHideOnClose(state: { closeToTray: boolean; trayReady: boolean; quitting: boolean }): boolean {
  return state.closeToTray && state.trayReady && !state.quitting;
}

/** A start at login shows no window only when the tray can bring it back; otherwise the user would see nothing. */
export function shouldStartHidden(state: { hiddenArg: boolean; closeToTray: boolean; trayReady: boolean }): boolean {
  return state.hiddenArg && state.closeToTray && state.trayReady;
}

export interface TrayHandle {
  update(tooltip: string, items: TrayMenuItem[]): void;
  destroy(): void;
}

export interface SystemDeps {
  /** Creates the OS tray icon; throws where there is none. */
  createTray(onAction: (action: TrayAction) => void): TrayHandle;
  open(): void;
  checkUpdates(): Promise<unknown>;
  quit(): void;
  downloads: { isPaused(): boolean; pauseAll(): void; resumeAll(): void };
  text(): TrayText;
  log: { warn(message: string, error?: unknown): void };
}

/** Owns the tray: created while `closeToTray` is on, and `trayReady` says whether it actually exists. */
export class SystemIntegration {
  private tray: TrayHandle | null = null;
  private closeToTray = false;
  private quitting = false;
  private lastMenu = '';

  constructor(private readonly deps: SystemDeps) {}

  get trayReady(): boolean {
    return this.tray !== null;
  }

  /** Brings the tray in line with the setting. Never throws: a failed tray just means close quits as usual. */
  apply(closeToTray: boolean): void {
    this.closeToTray = closeToTray;
    if (!closeToTray) {
      this.destroyTray();
      return;
    }
    if (this.tray) return;
    try {
      this.tray = this.deps.createTray((action) => this.run(action));
      this.lastMenu = '';
      this.refresh();
    } catch (error) {
      this.tray = null;
      this.deps.log.warn('system tray unavailable, closing the window will quit', error);
    }
  }

  /** Rebuilds the menu when what it shows (pause or resume, language) changed. */
  refresh(): void {
    if (!this.tray) return;
    const text = this.deps.text();
    const items = trayMenuModel(text, this.deps.downloads.isPaused());
    const key = JSON.stringify([text.tooltip, items]);
    if (key === this.lastMenu) return;
    this.lastMenu = key;
    this.tray.update(text.tooltip, items);
  }

  markQuitting(): void {
    this.quitting = true;
  }

  /** The window's `close` handler asks this; true means hide it instead. */
  shouldHideOnClose(): boolean {
    return shouldHideOnClose({ closeToTray: this.closeToTray, trayReady: this.trayReady, quitting: this.quitting });
  }

  /** `window-all-closed`: keep running with no window only while the tray can bring it back. */
  keepsRunning(): boolean {
    return this.shouldHideOnClose();
  }

  shouldStartHidden(argv: readonly string[]): boolean {
    return shouldStartHidden({
      hiddenArg: startedHidden(argv),
      closeToTray: this.closeToTray,
      trayReady: this.trayReady,
    });
  }

  dispose(): void {
    this.destroyTray();
  }

  private destroyTray(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  private run(action: TrayAction): void {
    const { downloads } = this.deps;
    try {
      if (action === 'open') this.deps.open();
      else if (action === 'quit') {
        this.markQuitting();
        this.deps.quit();
      } else if (action === 'toggleDownloads') {
        if (downloads.isPaused()) downloads.resumeAll();
        else downloads.pauseAll();
        this.refresh();
      } else {
        this.deps
          .checkUpdates()
          .catch((error: unknown) => this.deps.log.warn('update check from the tray failed', error));
      }
    } catch (error) {
      this.deps.log.warn(`tray action ${action} failed`, error);
    }
  }
}
