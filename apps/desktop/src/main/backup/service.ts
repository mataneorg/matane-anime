import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  AppError,
  type BackupAutoMode,
  type BackupFile,
  type BackupFolderInfo,
  type BackupManifest,
  type BackupPreview,
  type BackupRestoreResult,
  KEEP_AUTO_BACKUPS,
  isAbsolutePath,
} from '@matane-anime/shared';
import type Database from 'better-sqlite3';
import { parseBackup } from './archive';
import { createBackup } from './create';
import { stageBackup } from './restore';

const MANUAL_PREFIX = 'matane-anime-backup-';
const AUTO_PREFIX = 'matane-anime-auto-';
/** A backup file is never read when it is larger than this (the archive checks refuse such files anyway). */
const MAX_BACKUP_BYTES = 1024 * 1024 * 1024;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** How often the schedule looks at whether a backup is due, and how long after start the first look is. */
const CHECK_EVERY_MS = HOUR_MS;
const FIRST_CHECK_MS = 60_000;

/** `2026-10-09T10-00-00`: sorts like time and is safe in a file name. */
const stamp = (date: Date): string => date.toISOString().slice(0, 19).replaceAll(':', '-');

export interface BackupServiceDeps {
  sqlite: Database.Database;
  userData: string;
  appVersion: string;
  /** Number of migrations this app ships: a backup with more is refused. */
  bundledMigrations: number;
  /** Restarts the app so the staged restore is applied before the database opens. */
  restart(): void;
  now?: () => Date;
  /** The backup settings; without them the schedule is off and the default folder is used. */
  config?: () => { auto: BackupAutoMode; folder: string | null };
  /** When the last automatic backup was written (ms), kept across runs. */
  lastAuto?: { get(): number | null; set(ms: number): void };
  log?: (message: string) => void;
}

/** The part of backup and restore that the IPC handlers call; dialogs stay in the handlers. */
export class BackupService {
  private readonly deps: BackupServiceDeps;
  /** Backups the user picked, by token, until they are restored or the app ends. */
  private readonly picked = new Map<string, string>();

  constructor(deps: BackupServiceDeps) {
    this.deps = deps;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** The folder backups are written to: the chosen one, else `backups/files` in the app data. */
  folder(): BackupFolderInfo {
    const configured = this.deps.config?.().folder ?? null;
    // Settings are validated, but a relative path would resolve against wherever the app was started.
    const chosen = configured !== null && isAbsolutePath(configured) ? configured : null;
    return chosen
      ? { path: chosen, isDefault: false }
      : { path: join(this.deps.userData, 'backups', 'files'), isDefault: true };
  }

  /** The backup files in the folder, newest first. A missing folder is an empty list. */
  async list(): Promise<BackupFile[]> {
    const { path } = this.folder();
    let names: string[];
    try {
      names = await readdir(path);
    } catch {
      return [];
    }
    const files: BackupFile[] = [];
    for (const name of names) {
      const auto = name.startsWith(AUTO_PREFIX);
      if (!(auto || name.startsWith(MANUAL_PREFIX)) || !name.endsWith('.zip')) continue;
      try {
        const file = join(path, name);
        const info = await stat(file);
        if (info.isFile()) files.push({ path: file, name, sizeBytes: info.size, modifiedAt: info.mtimeMs, auto });
      } catch {
        // gone since it was listed
      }
    }
    return files.sort((a, b) => b.modifiedAt - a.modifiedAt || b.name.localeCompare(a.name));
  }

  /** Writes a backup into the folder right now. */
  async createNow(auto = false): Promise<BackupFile> {
    const { path } = this.folder();
    mkdirSync(path, { recursive: true });
    const name = `${auto ? AUTO_PREFIX : MANUAL_PREFIX}${stamp(this.now())}.zip`;
    const file = join(path, name);
    await this.exportTo(file);
    const info = await stat(file);
    return { path: file, name, sizeBytes: info.size, modifiedAt: info.mtimeMs, auto };
  }

  /** Whether an automatic backup is due: daily or weekly since the last one. */
  isAutoDue(): boolean {
    const auto = this.deps.config?.().auto ?? 'off';
    if (auto === 'off') return false;
    const last = this.deps.lastAuto?.get() ?? null;
    const now = this.now().getTime();
    // A last backup "in the future" (the clock was moved back) must not hold the schedule off for good.
    return last === null || last > now || now - last >= (auto === 'daily' ? DAY_MS : 7 * DAY_MS);
  }

  /** Writes an automatic backup when due, then keeps the newest `KEEP_AUTO` of them. Null when nothing was due. */
  async runAutoIfDue(): Promise<BackupFile | null> {
    if (!this.isAutoDue()) return null;
    const file = await this.createNow(true);
    this.deps.lastAuto?.set(this.now().getTime());
    const old = (await this.list()).filter((entry) => entry.auto).slice(KEEP_AUTO_BACKUPS);
    for (const entry of old) await rm(entry.path, { force: true });
    return file;
  }

  private timers: NodeJS.Timeout[] = [];

  /** Looks soon after start and then hourly; a failed backup is logged and tried again at the next look. */
  startSchedule(): void {
    if (this.timers.length > 0) return;
    const check = (): void => {
      this.runAutoIfDue().catch((error: unknown) => this.deps.log?.(`automatic backup failed: ${String(error)}`));
    };
    this.timers = [setTimeout(check, FIRST_CHECK_MS), setInterval(check, CHECK_EVERY_MS)];
    for (const timer of this.timers) timer.unref();
  }

  stopSchedule(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers = [];
  }

  defaultFileName(): string {
    return `matane-anime-backup-${this.now().toISOString().slice(0, 10)}.zip`;
  }

  async exportTo(path: string): Promise<BackupManifest> {
    return createBackup({
      sqlite: this.deps.sqlite,
      coversDir: join(this.deps.userData, 'covers'),
      workDir: join(this.deps.userData, 'backups', 'tmp'),
      appVersion: this.deps.appVersion,
      now: this.now(),
      outPath: path,
    });
  }

  /**
   * Like `peek`, for a file of the backup list only: it must sit directly in the backup folder, be named like our
   * backups, and be a plain file (not a link) of a sane size. The renderer cannot use it to read other files.
   */
  peekListed(path: string): BackupPreview {
    const file = resolve(path);
    const name = basename(file);
    const listed = (name.startsWith(MANUAL_PREFIX) || name.startsWith(AUTO_PREFIX)) && name.endsWith('.zip');
    if (!listed || dirname(file) !== resolve(this.folder().path)) {
      throw new AppError('invalid_input', 'That file is not in the backup folder.');
    }
    let info;
    try {
      info = lstatSync(file);
    } catch {
      throw new AppError('not_found', 'The backup file could not be read.');
    }
    if (!info.isFile() || info.size > MAX_BACKUP_BYTES) {
      throw new AppError('invalid_input', 'That file is not a usable backup.');
    }
    return this.peek(file);
  }

  /** Reads and checks a backup file without applying it. */
  peek(path: string): BackupPreview {
    const { manifest } = this.read(path);
    const token = randomUUID();
    this.picked.clear();
    this.picked.set(token, path);
    return { token, fileName: basename(path), manifest };
  }

  /** Stages the backup the token stands for and restarts the app; the result goes back before the restart. */
  import(token: string): BackupRestoreResult {
    const path = this.picked.get(token);
    if (!path) throw new AppError('not_found', 'That backup is no longer selected. Pick the file again.');
    const backup = this.read(path);
    const { extensionsToReinstall } = stageBackup(backup, {
      userData: this.deps.userData,
      bundledMigrations: this.deps.bundledMigrations,
    });
    this.picked.delete(token);
    this.deps.restart();
    return { counts: backup.manifest.counts, extensionsToReinstall, reloaded: true };
  }

  private read(path: string) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch {
      throw new AppError('not_found', 'The backup file could not be read.');
    }
    return parseBackup(bytes, this.deps.bundledMigrations);
  }
}
