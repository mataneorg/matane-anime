import { index, integer, sqliteTable } from 'drizzle-orm/sqlite-core';
import { anime, episodes } from './library';

/** One row per anime; deleting history never touches `watch_sessions` (statistics, PRG-10). */
export const history = sqliteTable(
  'history',
  {
    animeId: integer()
      .primaryKey()
      .references(() => anime.id, { onDelete: 'cascade' }),
    episodeId: integer()
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    watchedAt: integer().notNull(),
  },
  (t) => [index('history_watched_at_idx').on(t.watchedAt)],
);

export const watchSessions = sqliteTable(
  'watch_sessions',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    animeId: integer()
      .notNull()
      .references(() => anime.id, { onDelete: 'cascade' }),
    episodeId: integer()
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    startedAt: integer().notNull(),
    endedAt: integer(),
    activeMs: integer().notNull().default(0),
  },
  (t) => [index('watch_sessions_started_at_idx').on(t.startedAt)],
);
