import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUTOSTART_FILE,
  applyLinuxAutostart,
  applyRunAtLogin,
  autostartCommand,
  desktopEntry,
  quoteExecArg,
} from './autostart';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'matane-autostart-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('Exec line', () => {
  it('quotes only what needs it', () => {
    expect(quoteExecArg('/opt/matane/app')).toBe('/opt/matane/app');
    expect(quoteExecArg('/home/me/My Apps/Matane Anime.AppImage')).toBe('"/home/me/My Apps/Matane Anime.AppImage"');
    expect(quoteExecArg('/a"b$c`d\\e')).toBe('"/a\\"b\\$c\\`d\\\\e"');
    expect(quoteExecArg('/tmp/100%')).toBe('"/tmp/100%%"');
  });

  it('points at the AppImage when there is one, else at the executable, and adds --hidden', () => {
    expect(autostartCommand({ appImage: '/home/me/Matane.AppImage', execPath: '/tmp/.mount_x/matane' })).toBe(
      '/home/me/Matane.AppImage --hidden',
    );
    expect(autostartCommand({ execPath: '/usr/lib/matane-anime/matane-anime' })).toBe(
      '/usr/lib/matane-anime/matane-anime --hidden',
    );
    expect(autostartCommand({ appImage: '', execPath: '/usr/bin/matane' })).toBe('/usr/bin/matane --hidden');
  });
});

describe('Linux autostart file', () => {
  it('is a valid desktop entry that starts the app hidden', () => {
    const entry = desktopEntry({ execPath: '/usr/bin/matane' });
    expect(entry.split('\n')).toEqual([
      '[Desktop Entry]',
      'Type=Application',
      'Name=Matane Anime',
      'Comment=Start Matane Anime in the background',
      'Exec=/usr/bin/matane --hidden',
      'Terminal=false',
      'X-GNOME-Autostart-enabled=true',
      '',
    ]);
  });

  it('writes the file (creating the directory) and replaces it atomically, leaving no temp file', () => {
    const autostart = join(dir, 'config', 'autostart');
    applyLinuxAutostart(true, { dir: autostart, execPath: '/old/matane' });
    applyLinuxAutostart(true, { dir: autostart, execPath: '/tmp/.mount_x/matane', appImage: '/home/me/M.AppImage' });
    expect(readdirSync(autostart)).toEqual([AUTOSTART_FILE]);
    expect(readFileSync(join(autostart, AUTOSTART_FILE), 'utf8')).toContain('Exec=/home/me/M.AppImage --hidden\n');
  });

  it('removes the file when turned off, and turning it off twice is fine', () => {
    const env = { dir, execPath: '/usr/bin/matane' };
    applyLinuxAutostart(true, env);
    expect(existsSync(join(dir, AUTOSTART_FILE))).toBe(true);
    applyLinuxAutostart(false, env);
    applyLinuxAutostart(false, env);
    expect(existsSync(join(dir, AUTOSTART_FILE))).toBe(false);
  });
});

describe('applyRunAtLogin', () => {
  it('uses login items on Windows and macOS, with --hidden', () => {
    for (const platform of ['win32', 'darwin'] as const) {
      const calls: unknown[] = [];
      applyRunAtLogin(true, {
        platform,
        setLoginItemSettings: (settings) => calls.push(settings),
        linux: { dir, execPath: '/x' },
      });
      applyRunAtLogin(false, {
        platform,
        setLoginItemSettings: (settings) => calls.push(settings),
        linux: { dir, execPath: '/x' },
      });
      expect(calls).toEqual([
        { openAtLogin: true, args: ['--hidden'] },
        { openAtLogin: false, args: ['--hidden'] },
      ]);
      expect(existsSync(join(dir, AUTOSTART_FILE))).toBe(false);
    }
  });

  it('writes the XDG entry on Linux and never calls the login items', () => {
    const calls: unknown[] = [];
    const deps = {
      platform: 'linux' as const,
      setLoginItemSettings: (settings: unknown) => calls.push(settings),
      linux: { dir, execPath: '/usr/bin/matane' },
    };
    applyRunAtLogin(true, deps);
    expect(existsSync(join(dir, AUTOSTART_FILE))).toBe(true);
    applyRunAtLogin(false, deps);
    expect(existsSync(join(dir, AUTOSTART_FILE))).toBe(false);
    expect(calls).toEqual([]);
  });
});
