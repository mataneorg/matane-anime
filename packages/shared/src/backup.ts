import { z } from 'zod';

/** How much a backup holds, shown before a restore. */
export const backupCountsSchema = z.object({
  anime: z.number().int(),
  episodes: z.number().int(),
  categories: z.number().int(),
  history: z.number().int(),
  covers: z.number().int(),
  repositories: z.number().int(),
  extensions: z.number().int(),
});
export type BackupCounts = z.infer<typeof backupCountsSchema>;

/** `manifest.json` inside the backup archive. */
export const backupManifestSchema = z.object({
  format: z.literal(1),
  appVersion: z.string(),
  /** The number of migrations the database had applied; a newer one than the app knows is refused. */
  schemaVersion: z.number().int(),
  createdAt: z.string(),
  counts: backupCountsSchema,
});
export type BackupManifest = z.infer<typeof backupManifestSchema>;

/** A backup file the user picked, read but not applied. `token` is what `backup.import` takes. */
export const backupPreviewSchema = z.object({
  token: z.string(),
  fileName: z.string(),
  manifest: backupManifestSchema,
});
export type BackupPreview = z.infer<typeof backupPreviewSchema>;

export const backupRestoreResultSchema = z.object({
  counts: backupCountsSchema,
  /** Extension ids to install again from the restored repositories. */
  extensionsToReinstall: z.array(z.string()),
  /** The app reloads its window to show the restored data. */
  reloaded: z.boolean(),
});
export type BackupRestoreResult = z.infer<typeof backupRestoreResultSchema>;

/** How often a backup is written by itself. */
export const BACKUP_AUTO_MODES = ['off', 'daily', 'weekly'] as const;
export type BackupAutoMode = (typeof BACKUP_AUTO_MODES)[number];

/** A backup file in the backup folder. `auto` ones were written by the schedule and are pruned; the rest are kept. */
export const backupFileSchema = z.object({
  path: z.string(),
  name: z.string(),
  sizeBytes: z.number().int(),
  modifiedAt: z.number(),
  auto: z.boolean(),
});
export type BackupFile = z.infer<typeof backupFileSchema>;

/** The backup folder in use and whether it is the default one. */
export const backupFolderInfoSchema = z.object({ path: z.string(), isDefault: z.boolean() });
export type BackupFolderInfo = z.infer<typeof backupFolderInfoSchema>;

/** Automatic backups kept in the backup folder; older ones are removed. Backups made by hand are never removed. */
export const KEEP_AUTO_BACKUPS = 7;

/** An absolute path on any platform (POSIX, drive letter or UNC), checked without `node:path` so the renderer can use it. */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}
