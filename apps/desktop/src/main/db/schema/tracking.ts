import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { anime } from './library';

// Prepared for the trackers (AniList, MyAnimeList, Kitsu), which arrive after v1 (docs/PRD.md §5).

export const trackerAccounts = sqliteTable('tracker_accounts', {
  service: text().primaryKey(),
  userId: text(),
  username: text(),
  /** Encrypted with Electron safeStorage. */
  tokenEncrypted: text(),
  expiresAt: integer(),
});

export const animeTracks = sqliteTable(
  'anime_tracks',
  {
    animeId: integer()
      .notNull()
      .references(() => anime.id, { onDelete: 'cascade' }),
    service: text().notNull(),
    remoteId: text().notNull(),
    remoteUrl: text(),
    /** The title on the tracker, for the tracking dialog. */
    remoteTitle: text(),
    status: text(),
    score: real(),
    /** The episode number reached. */
    progress: real(),
    startedAt: integer(),
    finishedAt: integer(),
    syncBack: integer({ mode: 'boolean' }).notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.animeId, t.service] })],
);

export const trackerQueue = sqliteTable('tracker_queue', {
  id: integer().primaryKey({ autoIncrement: true }),
  animeId: integer()
    .notNull()
    .references(() => anime.id, { onDelete: 'cascade' }),
  service: text().notNull(),
  payloadJson: text().notNull(),
  attempts: integer().notNull().default(0),
  nextAttemptAt: integer().notNull(),
});
