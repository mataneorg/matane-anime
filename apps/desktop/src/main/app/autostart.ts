// Run at login (docs/PRD.md UPD-9). Windows and macOS have login items; Electron has none on Linux, where the
// XDG autostart spec applies: a `.desktop` file in `~/.config/autostart`. Everything outside Electron is
// injectable so it tests against a temp directory.

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HIDDEN_ARG } from './system';

export const AUTOSTART_FILE = 'matane-anime.desktop';

/** Quotes one argument for a `.desktop` `Exec` line (Desktop Entry spec: `"`, `` ` ``, `$`, `\` escaped, `%` doubled). */
export function quoteExecArg(arg: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) && !arg.includes('%')) return arg;
  return `"${arg.replace(/[\\"`$]/g, '\\$&').replace(/%/g, '%%')}"`;
}

/** What starts at login: the AppImage itself when running from one (`process.execPath` is inside a temp mount). */
export function autostartCommand(env: { appImage?: string | undefined; execPath: string }): string {
  return [env.appImage || env.execPath, HIDDEN_ARG].map(quoteExecArg).join(' ');
}

export function desktopEntry(env: { appImage?: string | undefined; execPath: string }): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Matane Anime',
    'Comment=Start Matane Anime in the background',
    `Exec=${autostartCommand(env)}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

export interface LinuxAutostart {
  /** `~/.config/autostart` (honouring `XDG_CONFIG_HOME`). */
  dir: string;
  execPath: string;
  appImage?: string | undefined;
}

/** Writes the entry atomically (a half-written file at login would do nothing), or removes it. */
export function applyLinuxAutostart(enabled: boolean, autostart: LinuxAutostart): void {
  const file = join(autostart.dir, AUTOSTART_FILE);
  if (!enabled) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(autostart.dir, { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, desktopEntry(autostart), { mode: 0o644 });
  renameSync(temp, file);
}

export interface LoginItemDeps {
  platform: NodeJS.Platform;
  /** `app.setLoginItemSettings`. */
  setLoginItemSettings(settings: { openAtLogin: boolean; args: string[] }): void;
  linux: LinuxAutostart;
}

export function applyRunAtLogin(enabled: boolean, deps: LoginItemDeps): void {
  if (deps.platform === 'linux') applyLinuxAutostart(enabled, deps.linux);
  else deps.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_ARG] });
}
