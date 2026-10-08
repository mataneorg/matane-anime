import type { HistoryEntry } from '@matane-anime/shared';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { history } from '../schema';
import type { ChangeEmitter } from './changes';

/** One row per anime: the episode last watched and when (docs/PRD.md PRG-8). Written only by WatchService. */
export class HistoryRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: ChangeEmitter,
  ) {}

  get(animeId: number) {
    return this.db.select().from(history).where(eq(history.animeId, animeId)).get();
  }

  /** `notify: false` for the routine refresh of the timestamp while an episode plays. */
  touch(animeId: number, episodeId: number, now: number, notify = true): void {
    this.db
      .insert(history)
      .values({ animeId, episodeId, watchedAt: now })
      .onConflictDoUpdate({ target: history.animeId, set: { episodeId, watchedAt: now } })
      .run();
    if (notify) this.changes.emit('history', 'library');
  }

  delete(animeId: number): void {
    this.db.delete(history).where(eq(history.animeId, animeId)).run();
    this.changes.emit('history', 'library');
  }

  /** Clears the history only: library, progress and watch sessions stay (PRG-10). */
  clear(): void {
    this.db.delete(history).run();
    this.changes.emit('history', 'library');
  }

  /** The history with what the list shows for each anime, newest first. `next` is filled in by the caller. */
  listWithContext(): Omit<HistoryEntry, 'next'>[] {
    const rows = this.db.$client
      .prepare(
        `SELECT h.anime_id AS animeId, a.source_id AS sourceId, s.name AS sourceName, a.title, a.thumbnail_url AS thumbnailUrl,
                a.cover_path IS NOT NULL AS hasLocalCover, h.episode_id AS episodeId, e.number AS episodeNumber,
                e.name AS episodeName, e.position_ms AS positionMs, e.duration_ms AS durationMs, e.watched AS watched,
                h.watched_at AS watchedAt
         FROM history h
         JOIN anime a ON a.id = h.anime_id
         JOIN episodes e ON e.id = h.episode_id
         LEFT JOIN sources s ON s.id = a.source_id
         ORDER BY h.watched_at DESC`,
      )
      .all() as (Omit<HistoryEntry, 'next' | 'hasLocalCover' | 'watched'> & {
      hasLocalCover: number;
      watched: number;
    })[];
    return rows.map((row) => ({ ...row, hasLocalCover: row.hasLocalCover === 1, watched: row.watched === 1 }));
  }
}
