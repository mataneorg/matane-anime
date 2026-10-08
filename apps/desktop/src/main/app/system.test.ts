import { describe, expect, it } from 'vitest';
import {
  HIDDEN_ARG,
  SystemIntegration,
  type SystemDeps,
  type TrayAction,
  type TrayMenuItem,
  shouldHideOnClose,
  shouldStartHidden,
  startedHidden,
  trayMenuModel,
  trayText,
} from './system';

class Harness {
  paused = false;
  failCreate = false;
  created = 0;
  destroyed = 0;
  menus: { tooltip: string; items: TrayMenuItem[] }[] = [];
  calls: string[] = [];
  warnings: string[] = [];
  language: 'en' | 'id' = 'en';
  onAction: (action: TrayAction) => void = () => undefined;
  checkResult: Promise<unknown> = Promise.resolve();

  readonly system = new SystemIntegration({
    createTray: (onAction) => {
      if (this.failCreate) throw new Error('no tray here');
      this.created++;
      this.onAction = onAction;
      return {
        update: (tooltip, items) => this.menus.push({ tooltip, items }),
        destroy: () => this.destroyed++,
      };
    },
    open: () => this.calls.push('open'),
    checkUpdates: () => {
      this.calls.push('check');
      return this.checkResult;
    },
    quit: () => this.calls.push('quit'),
    downloads: {
      isPaused: () => this.paused,
      pauseAll: () => {
        this.calls.push('pauseAll');
        this.paused = true;
      },
      resumeAll: () => {
        this.calls.push('resumeAll');
        this.paused = false;
      },
    },
    text: () => trayText(this.language),
    log: { warn: (message) => this.warnings.push(message) },
  } satisfies SystemDeps);
}

describe('arguments', () => {
  it('recognises the hidden start', () => {
    expect(startedHidden(['app', HIDDEN_ARG])).toBe(true);
    expect(startedHidden(['app', '--inspect'])).toBe(false);
    expect(HIDDEN_ARG).toBe('--hidden');
  });
});

describe('tray menu', () => {
  it('has open, check, pause or resume, and quit', () => {
    const running = trayMenuModel(trayText('en'), false);
    expect(running.map((item) => (item.type === 'item' ? `${item.id}:${item.label}` : '-'))).toEqual([
      'open:Open Matane Anime',
      'check:Check for updates now',
      'toggleDownloads:Pause downloads',
      '-',
      'quit:Quit',
    ]);
    expect(trayMenuModel(trayText('en'), true)).toContainEqual({
      type: 'item',
      id: 'toggleDownloads',
      label: 'Resume downloads',
    });
    expect(trayMenuModel(trayText('id'), false)).toContainEqual({ type: 'item', id: 'quit', label: 'Keluar' });
  });
});

describe('close and start decisions', () => {
  it('hides on close only with the setting on, a working tray and no quit under way', () => {
    const base = { closeToTray: true, trayReady: true, quitting: false };
    expect(shouldHideOnClose(base)).toBe(true);
    expect(shouldHideOnClose({ ...base, closeToTray: false })).toBe(false);
    expect(shouldHideOnClose({ ...base, trayReady: false })).toBe(false);
    expect(shouldHideOnClose({ ...base, quitting: true })).toBe(false);
  });

  it('starts hidden only when asked to and the tray can bring the window back', () => {
    const base = { hiddenArg: true, closeToTray: true, trayReady: true };
    expect(shouldStartHidden(base)).toBe(true);
    expect(shouldStartHidden({ ...base, hiddenArg: false })).toBe(false);
    expect(shouldStartHidden({ ...base, closeToTray: false })).toBe(false);
    expect(shouldStartHidden({ ...base, trayReady: false })).toBe(false);
  });
});

describe('SystemIntegration', () => {
  it('creates no tray while the setting is off, so closing quits as usual', () => {
    const h = new Harness();
    h.system.apply(false);
    expect(h.created).toBe(0);
    expect(h.system.shouldHideOnClose()).toBe(false);
    expect(h.system.keepsRunning()).toBe(false);
    expect(h.system.shouldStartHidden(['x', HIDDEN_ARG])).toBe(false);
  });

  it('creates the tray once, hides on close and keeps running with no window', () => {
    const h = new Harness();
    h.system.apply(true);
    h.system.apply(true);
    expect(h.created).toBe(1);
    expect(h.menus).toHaveLength(1);
    expect(h.system.shouldHideOnClose()).toBe(true);
    expect(h.system.keepsRunning()).toBe(true);
    expect(h.system.shouldStartHidden(['x', HIDDEN_ARG])).toBe(true);
    expect(h.system.shouldStartHidden(['x'])).toBe(false);
  });

  it('removes the tray when the setting goes off', () => {
    const h = new Harness();
    h.system.apply(true);
    h.system.apply(false);
    expect(h.destroyed).toBe(1);
    expect(h.system.trayReady).toBe(false);
    expect(h.system.shouldHideOnClose()).toBe(false);
  });

  it('survives a tray that cannot be created: logs it and closes as usual', () => {
    const h = new Harness();
    h.failCreate = true;
    expect(() => h.system.apply(true)).not.toThrow();
    expect(h.warnings).toHaveLength(1);
    expect(h.system.trayReady).toBe(false);
    expect(h.system.shouldHideOnClose()).toBe(false);
    expect(h.system.keepsRunning()).toBe(false);
    expect(h.system.shouldStartHidden(['x', HIDDEN_ARG])).toBe(false);
    h.failCreate = false;
    h.system.apply(true); // works once a tray is available
    expect(h.system.trayReady).toBe(true);
  });

  it('quits for real from the tray: the close that follows is not hidden', () => {
    const h = new Harness();
    h.system.apply(true);
    expect(h.system.shouldHideOnClose()).toBe(true);
    h.onAction('quit');
    expect(h.calls).toEqual(['quit']);
    expect(h.system.shouldHideOnClose()).toBe(false);
    expect(h.system.keepsRunning()).toBe(false);
  });

  it('also stops hiding when the app quits some other way', () => {
    const h = new Harness();
    h.system.apply(true);
    h.system.markQuitting();
    expect(h.system.shouldHideOnClose()).toBe(false);
  });

  it('runs the menu actions, and swaps pause for resume', () => {
    const h = new Harness();
    h.system.apply(true);
    h.onAction('open');
    h.onAction('check');
    h.onAction('toggleDownloads');
    expect(h.calls).toEqual(['open', 'check', 'pauseAll']);
    const last = h.menus.at(-1)!.items;
    expect(last).toContainEqual({ type: 'item', id: 'toggleDownloads', label: 'Resume downloads' });
    h.onAction('toggleDownloads');
    expect(h.calls.at(-1)).toBe('resumeAll');
  });

  it('refreshes the menu only when it changed', () => {
    const h = new Harness();
    h.system.apply(true);
    h.system.refresh();
    expect(h.menus).toHaveLength(1);
    h.paused = true;
    h.system.refresh();
    expect(h.menus).toHaveLength(2);
    h.language = 'id';
    h.system.refresh();
    expect(h.menus).toHaveLength(3);
  });

  it('logs a failed update check instead of throwing', async () => {
    const h = new Harness();
    h.checkResult = Promise.reject(new Error('offline'));
    h.system.apply(true);
    h.onAction('check');
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.warnings).toEqual(['update check from the tray failed']);
  });
});
