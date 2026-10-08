import { z } from 'zod';

// Downloads as they cross IPC (docs/PRD.md §6.7, DL-1…14).

export const DOWNLOAD_STATUSES = ['queued', 'downloading', 'paused', 'error', 'done'] as const;
export const downloadStatusSchema = z.enum(DOWNLOAD_STATUSES);
export type DownloadStatus = z.infer<typeof downloadStatusSchema>;

export const downloadKindSchema = z.enum(['hls', 'mp4']);
export type DownloadKind = z.infer<typeof downloadKindSchema>;

/** `error` of a download whose files are gone: playback falls back to streaming (STR-7). */
export const DOWNLOAD_FILE_MISSING = 'file_missing';

export const downloadItemSchema = z.object({
  id: z.number().int(),
  episodeId: z.number().int(),
  animeId: z.number().int(),
  sourceId: z.string(),
  sourceName: z.string().nullable(),
  animeTitle: z.string(),
  thumbnailUrl: z.string().nullable(),
  hasLocalCover: z.boolean(),
  episodeNumber: z.number().nullable(),
  episodeName: z.string(),
  status: downloadStatusSchema,
  /** Position in the queue; the smaller goes first. */
  queueOrder: z.number().int(),
  kind: downloadKindSchema,
  segmentsDone: z.number().int(),
  segmentsTotal: z.number().int().nullable(),
  bytesDone: z.number(),
  sizeBytes: z.number().nullable(),
  /** Height in pixels of the variant that was picked. */
  quality: z.number().int().nullable(),
  server: z.string().nullable(),
  /** A short code or message for `error` rows; the UI shows it next to Retry. */
  error: z.string().nullable(),
  createdAt: z.number(),
  completedAt: z.number().nullable(),
});
export type DownloadItem = z.infer<typeof downloadItemSchema>;

/** What changes many times a second while a download runs; sent as an event and kept out of the query cache. */
export const downloadProgressSchema = z.object({
  id: z.number().int(),
  episodeId: z.number().int(),
  status: downloadStatusSchema,
  segmentsDone: z.number().int(),
  segmentsTotal: z.number().int().nullable(),
  bytesDone: z.number(),
  sizeBytes: z.number().nullable(),
  bytesPerSecond: z.number(),
  etaSeconds: z.number().nullable(),
});
export type DownloadProgress = z.infer<typeof downloadProgressSchema>;

export const DOWNLOAD_REFUSALS = ['size_limit', 'disk_space', 'no_extension', 'live', 'no_stream'] as const;
export type DownloadRefusal = (typeof DOWNLOAD_REFUSALS)[number];

export const enqueueInputSchema = z.object({
  episodeIds: z.array(z.number().int()).min(1).max(5000),
  /** Download although the size limit would be passed. Manual downloads only, after the user confirmed (DL-10). */
  force: z.boolean().optional(),
});
export type EnqueueInput = z.infer<typeof enqueueInputSchema>;

export const enqueueResultSchema = z.object({
  queued: z.array(z.number().int()),
  /** Already downloaded or in the queue. */
  existing: z.array(z.number().int()),
  refused: z.array(z.object({ episodeId: z.number().int(), reason: z.enum(DOWNLOAD_REFUSALS) })),
});
export type EnqueueResult = z.infer<typeof enqueueResultSchema>;

export const downloadStorageSchema = z.object({
  /** Where new downloads go. */
  folder: z.string(),
  usedBytes: z.number(),
  limitBytes: z.number(),
  /** Free space on the drive of `folder`; null when the OS could not tell. */
  freeBytes: z.number().nullable(),
  counts: z.object({
    downloading: z.number().int(),
    queued: z.number().int(),
    paused: z.number().int(),
    error: z.number().int(),
    done: z.number().int(),
  }),
});
export type DownloadStorage = z.infer<typeof downloadStorageSchema>;
