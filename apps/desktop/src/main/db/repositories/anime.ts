import type { AnimeDetails, AnimeSummary } from '@matane-anime/extension-sdk';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { anime } from '../schema';
import type { ChangeEmitter } from './changes';

export type AnimeRow = typeof anime.$inferSelect;

/** The `anime` table as the browse and detail screens use it (library features come in phase 2). */
export class AnimeRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: ChangeEmitter,
  ) {}

  get(id: number): AnimeRow | undefined {
    return this.db.select().from(anime).where(eq(anime.id, id)).get();
  }

  find(sourceId: string, url: string): AnimeRow | undefined {
    return this.db
      .select()
      .from(anime)
      .where(and(eq(anime.sourceId, sourceId), eq(anime.url, url)))
      .get();
  }

  /** What the user picked by hand in the player for this anime (STR-5): `{ server, quality }`. */
  playbackPrefs(row: AnimeRow): { server?: string; quality?: number | null } | null {
    if (!row.playbackPrefsJson) return null;
    try {
      const value: unknown = JSON.parse(row.playbackPrefsJson);
      return value && typeof value === 'object' ? (value as { server?: string; quality?: number | null }) : null;
    } catch {
      return null;
    }
  }

  savePlaybackPrefs(id: number, prefs: { server: string; quality: number | null }): void {
    this.db
      .update(anime)
      .set({ playbackPrefsJson: JSON.stringify(prefs) })
      .where(eq(anime.id, id))
      .run();
  }

  /**
   * Stores what a listing showed, one row per `(source, url)`. A listing never overwrites what the detail
   * page told us, and never touches `inLibrary` or `addedAt`. Returns the rows in the order given.
   */
  upsertSummaries(sourceId: string, items: AnimeSummary[], now = Date.now()): AnimeRow[] {
    if (items.length === 0) return [];
    const unique = items.filter((item, index) => items.findIndex((other) => other.url === item.url) === index);
    this.db.transaction((tx) => {
      for (const item of unique) {
        tx.insert(anime)
          .values({
            sourceId,
            url: item.url,
            title: item.title,
            thumbnailUrl: item.thumbnailUrl ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [anime.sourceId, anime.url],
            set: {
              title: item.title,
              updatedAt: now,
              // Keep a known cover when a later listing has none.
              ...(item.thumbnailUrl ? { thumbnailUrl: item.thumbnailUrl } : {}),
            },
          })
          .run();
      }
    });
    const rows = this.db
      .select()
      .from(anime)
      .where(
        and(
          eq(anime.sourceId, sourceId),
          inArray(
            anime.url,
            unique.map((item) => item.url),
          ),
        ),
      )
      .all();
    const byUrl = new Map(rows.map((row) => [row.url, row]));
    this.changes.emit('anime');
    return items.map((item) => byUrl.get(item.url) as AnimeRow);
  }

  /** Stores the detail page; `lastUpdateCheckAt` doubles as "details last fetched". */
  saveDetails(id: number, details: AnimeDetails, now = Date.now(), latestEpisodeAt?: number): void {
    this.db
      .update(anime)
      .set({
        title: details.title,
        altTitlesJson: JSON.stringify(details.altTitles ?? []),
        description: details.description ?? null,
        genresJson: JSON.stringify(details.genres ?? []),
        studio: details.studio ?? null,
        year: details.year ?? null,
        status: details.status,
        type: details.type ?? null,
        ...(details.thumbnailUrl ? { thumbnailUrl: details.thumbnailUrl } : {}),
        ...(latestEpisodeAt !== undefined ? { latestEpisodeAt } : {}),
        lastUpdateCheckAt: now,
        updatedAt: now,
      })
      .where(eq(anime.id, id))
      .run();
    this.changes.emit(`anime:${id}`);
  }
}
