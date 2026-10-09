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
