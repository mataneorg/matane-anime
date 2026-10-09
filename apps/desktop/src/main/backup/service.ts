import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { AppError, type BackupManifest, type BackupPreview, type BackupRestoreResult } from '@matane-anime/shared';
import type Database from 'better-sqlite3';
import { parseBackup } from './archive';
import { createBackup } from './create';
import { stageBackup } from './restore';

export interface BackupServiceDeps {
  sqlite: Database.Database;
  userData: string;
  appVersion: string;
  /** Number of migrations this app ships: a backup with more is refused. */
  bundledMigrations: number;
  /** Restarts the app so the staged restore is applied before the database opens. */
  restart(): void;
  now?: () => Date;
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
