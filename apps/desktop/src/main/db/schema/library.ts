import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sources } from './extensions';

export const ANIME_STATUSES = ['ongoing', 'completed', 'hiatus', 'cancelled', 'unknown'] as const;
export const ANIME_TYPES = ['tv', 'movie', 'ova', 'ona', 'special'] as const;

export const anime = sqliteTable(
  'anime',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    sourceId: text()
      .notNull()
      .references(() => sources.id),
    /** Stable identity chosen by the extension (usually a relative path). */
    url: text().notNull(),
    title: text().notNull(),
    altTitlesJson: text().notNull().default('[]'),
    description: text(),
    genresJson: text().notNull().default('[]'),
    studio: text(),
    year: integer(),
    status: text({ enum: ANIME_STATUSES }).notNull().default('unknown'),
    type: text({ enum: ANIME_TYPES }),
    thumbnailUrl: text(),
    coverPath: text(),
    customCoverPath: text(),
    /** Dominant cover color used to tint the detail header. */
    coverColor: text(),
    inLibrary: integer({ mode: 'boolean' }).notNull().default(false),
    addedAt: integer(),
    lastUpdateCheckAt: integer(),
    /** When the update checker last looked at this anime (UPD-1). `lastUpdateCheckAt` also moves on a manual refresh. */
    updateCheckedAt: integer(),
    /** Why the last scheduled check failed; null when it worked (UPD-2). */
    updateError: text(),
    latestEpisodeAt: integer(),
    /** Server and quality the user picked by hand for this anime (STR-5). */
    playbackPrefsJson: text(),
    episodeViewJson: text(),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
  },
  (t) => [
    uniqueIndex('anime_source_url_unique').on(t.sourceId, t.url),
    index('anime_in_library_idx').on(t.inLibrary),
    // The library list filters on it and sorts by it.
    index('anime_library_added_idx').on(t.inLibrary, t.addedAt),
  ],
);

export const categories = sqliteTable('categories', {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  sortOrder: integer().notNull().default(0),
  settingsJson: text(),
});

export const animeCategories = sqliteTable(
  'anime_categories',
  {
    animeId: integer()
      .notNull()
      .references(() => anime.id, { onDelete: 'cascade' }),
    categoryId: integer()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.animeId, t.categoryId] }), index('anime_categories_category_idx').on(t.categoryId)],
);

export const episodes = sqliteTable(
  'episodes',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    animeId: integer()
      .notNull()
      .references(() => anime.id, { onDelete: 'cascade' }),
    url: text().notNull(),
    name: text().notNull(),
    number: real(),
    /** "Sub", "Dub", "BD"…; episodes with the same number count as one (PRG-5). */
    variant: text(),
    uploadedAt: integer(),
    sourceOrder: integer().notNull().default(0),
    fetchedAt: integer().notNull(),
    watched: integer({ mode: 'boolean' }).notNull().default(false),
    watchedAt: integer(),
    positionMs: integer().notNull().default(0),
    durationMs: integer(),
    sourceMissing: integer({ mode: 'boolean' }).notNull().default(false),
    /** When the user dismissed the episode from Updates without watching it; null while it still shows there. */
    updateSeenAt: integer(),
  },
  (t) => [
    uniqueIndex('episodes_anime_url_unique').on(t.animeId, t.url),
    index('episodes_anime_number_idx').on(t.animeId, t.number),
    index('episodes_fetched_at_idx').on(t.fetchedAt),
    // Unwatched counts and "continue" targets look episodes up by anime and watched state.
    index('episodes_anime_watched_idx').on(t.animeId, t.watched),
  ],
);
