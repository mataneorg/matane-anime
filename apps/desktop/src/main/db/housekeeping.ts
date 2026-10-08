import type Database from 'better-sqlite3';

/** A listing creates a row for every anime it shows; rows nobody kept are dropped after this long. */
export const BROWSE_ROW_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface PurgeResult {
  deleted: number;
  /** Covers on disk that belonged to the deleted rows, for the caller to remove. */
  coverPaths: string[];
}

/**
 * Opening a listing stores a row per anime shown (docs/adr/0016), so the table would grow with every browse.
 * This deletes the rows that are only cache: not in the library, untouched for `ttlMs`, and with nothing the
 * user did attached to them: no history entry, no watched or started episode, no watch session (those are
 * kept for statistics), and no download (its row would cascade away and orphan the files on disk). Episodes, category links and the full-text index follow by cascade and triggers.
 */
export function purgeBrowseRows(sqlite: Database.Database, now: number, ttlMs = BROWSE_ROW_TTL_MS): PurgeResult {
  const stale = sqlite
    .prepare(
      `SELECT a.id, a.cover_path AS coverPath FROM anime a
       WHERE a.in_library = 0 AND a.updated_at < ?
         AND NOT EXISTS (SELECT 1 FROM history h WHERE h.anime_id = a.id)
         AND NOT EXISTS (SELECT 1 FROM watch_sessions w WHERE w.anime_id = a.id)
         AND NOT EXISTS (SELECT 1 FROM downloads d JOIN episodes de ON de.id = d.episode_id WHERE de.anime_id = a.id)
         AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.anime_id = a.id AND (e.watched = 1 OR e.position_ms > 0))`,
    )
    .all(now - ttlMs) as { id: number; coverPath: string | null }[];
  if (stale.length === 0) return { deleted: 0, coverPaths: [] };
  const remove = sqlite.prepare('DELETE FROM anime WHERE id = ?');
  sqlite.transaction(() => {
    for (const row of stale) remove.run(row.id);
  })();
  return { deleted: stale.length, coverPaths: stale.flatMap((row) => (row.coverPath ? [row.coverPath] : [])) };
}
