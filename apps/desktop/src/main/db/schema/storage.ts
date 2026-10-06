import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { episodes } from './library';

export const DOWNLOAD_STATUSES = ['queued', 'downloading', 'paused', 'error', 'done'] as const;
/** `hls`: a folder of segments with a local playlist; `mp4`: one file (DL-3, DL-4). */
export const DOWNLOAD_KINDS = ['hls', 'mp4'] as const;
export const IMAGE_CACHE_KINDS = ['browse_cover'] as const;

export const downloads = sqliteTable(
  'downloads',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    episodeId: integer()
      .notNull()
      .unique()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    status: text({ enum: DOWNLOAD_STATUSES }).notNull().default('queued'),
    queueOrder: integer().notNull().default(0),
    kind: text({ enum: DOWNLOAD_KINDS }).notNull(),
    segmentsDone: integer().notNull().default(0),
    segmentsTotal: integer(),
    bytesDone: integer().notNull().default(0),
    sizeBytes: integer(),
    /** Height in pixels of the variant that was picked. */
    quality: integer(),
    /** Server label of the stream that was picked. */
    server: text(),
    error: text(),
    /** Stored, never recomputed: moving the download folder rewrites it (DL-6). */
    path: text(),
    createdAt: integer().notNull(),
    completedAt: integer(),
  },
  (t) => [index('downloads_status_order_idx').on(t.status, t.queueOrder)],
);

export const imageCache = sqliteTable(
  'image_cache',
  {
    key: text().primaryKey(),
    kind: text({ enum: IMAGE_CACHE_KINDS }).notNull(),
    path: text().notNull(),
    sizeBytes: integer().notNull(),
    contentType: text(),
    lastAccessAt: integer().notNull(),
  },
  (t) => [index('image_cache_last_access_idx').on(t.lastAccessAt)],
);
