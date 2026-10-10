import {
  type CountableEpisode,
  type DownloadStatus,
  UPDATE_WINDOW_MS,
  type UpdateEntry,
  type UpdateFailure,
  type UpdateScope,
  type UpdatesList,
} from '@matane-anime/shared';
import type { AppDatabase } from '../client';
import type { ChangeEmitter } from './changes';

/** An anime the update checker may look at. */
export interface UpdateTarget {
  animeId: number;
  title: string;
  sourceId: string;
  status: string;
}

/** What the skip rules (UPD-3) need to know about an anime. */
export interface AnimeFacts {
  hasHistory: boolean;
  hasSession: boolean;
  episodes: (CountableEpisode & { positionMs: number })[];
}

export interface NewEpisodeInfo {
  episodeId: number;
  animeId: number;
  animeTitle: string;
  number: number | null;
  sourceOrder: number;
}

export type AutoDownloadMode = 'include' | 'exclude';

/**
 * An episode is new (UPD-4) when the app first saw it after its anime joined the library, nobody watched
 * it, it is still listed by the source, it is not older than the window, and the user did not dismiss it. The
 * list is derived: marking the episode watched (through WatchService) or "seen" (`markSeen`, which only
 * stamps `update_seen_at`) is all it takes to drop out. A new episode always starts unseen.
 * `episodes_fetched_at_idx` serves the range, the rest is a lookup by primary key.
 */
const NEW_EPISODE = `a.in_library = 1 AND e.fetched_at > a.added_at AND e.watched = 0 AND e.source_missing = 0
                     AND e.fetched_at >= @since
                     AND e.update_seen_at IS NULL`;

/** The derived list of new episodes, and what the update checker reads and writes (docs/PRD.md UPD-1…6). */
export class UpdatesRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: ChangeEmitter,
  ) {}

  // ------------------------------------------------------------------ the list (UPD-4, UPD-8)

  list(now = Date.now()): UpdatesList {
    const rows = this.db.$client
      .prepare(
        `SELECT e.id AS episodeId, e.anime_id AS animeId, a.source_id AS sourceId, s.name AS sourceName,
                a.title AS animeTitle, a.thumbnail_url AS thumbnailUrl, a.cover_path IS NOT NULL AS hasLocalCover,
                e.number AS episodeNumber, e.name AS episodeName, e.variant, e.fetched_at AS fetchedAt,
                d.status AS downloadStatus
         FROM episodes e
         JOIN anime a ON a.id = e.anime_id
         LEFT JOIN sources s ON s.id = a.source_id
         LEFT JOIN downloads d ON d.episode_id = e.id
         WHERE ${NEW_EPISODE}
         ORDER BY e.fetched_at DESC, e.anime_id, e.source_order`,
      )
      .all({ since: now - UPDATE_WINDOW_MS }) as (Omit<UpdateEntry, 'hasLocalCover' | 'download'> & {
      hasLocalCover: number;
      downloadStatus: DownloadStatus | null;
    })[];
    const entries = rows.map(({ downloadStatus, hasLocalCover, ...row }): UpdateEntry => ({
      ...row,
      hasLocalCover: hasLocalCover === 1,
      download: downloadStatus ? { status: downloadStatus } : null,
    }));
    const failed = this.db.$client
      .prepare(
        `SELECT a.id AS animeId, a.title, s.name AS sourceName, a.update_error AS error
         FROM anime a LEFT JOIN sources s ON s.id = a.source_id
         WHERE a.in_library = 1 AND a.update_error IS NOT NULL ORDER BY a.title`,
      )
      .all() as UpdateFailure[];
    const last = this.db.$client
      .prepare('SELECT MAX(update_checked_at) AS at FROM anime WHERE in_library = 1')
      .get() as { at: number | null };
    return { entries, lastCheckedAt: last.at, failed };
  }

  /** The sidebar badge: how many entries `list` would show. */
  count(now = Date.now()): number {
    const row = this.db.$client
      .prepare(`SELECT COUNT(*) AS n FROM episodes e JOIN anime a ON a.id = e.anime_id WHERE ${NEW_EPISODE}`)
      .get({ since: now - UPDATE_WINDOW_MS }) as { n: number };
    return row.n;
  }

  /**
   * Dismisses these entries from the list and the badge without touching the episodes' watched state or
   * progress. Only entries the list shows are stamped, so an id that is watched, gone or already seen is skipped.
   * Returns how many entries were dismissed.
   */
  markSeen(episodeIds: number[], now = Date.now()): number {
    if (episodeIds.length === 0) return 0;
    const result = this.db.$client
      .prepare(
        `UPDATE episodes AS e SET update_seen_at = @now
         FROM anime AS a
         WHERE a.id = e.anime_id AND ${NEW_EPISODE} AND e.id IN (SELECT value FROM json_each(@ids))`,
      )
      .run({ now, since: now - UPDATE_WINDOW_MS, ids: JSON.stringify(episodeIds) });
    if (result.changes > 0) this.changes.emit('updates');
    return result.changes;
  }

  /** Dismisses every entry `list` shows now. Returns how many. */
  markAllSeen(now = Date.now()): number {
    const result = this.db.$client
      .prepare(
        `UPDATE episodes AS e SET update_seen_at = @now FROM anime AS a WHERE a.id = e.anime_id AND ${NEW_EPISODE}`,
      )
      .run({ now, since: now - UPDATE_WINDOW_MS });
    if (result.changes > 0) this.changes.emit('updates');
    return result.changes;
  }

  // ------------------------------------------------------------------ what to check

  /** The anime a check covers. `anime` is not limited to the library; `all` and `category` are. */
  targets(scope: UpdateScope): UpdateTarget[] {
    const columns = 'a.id AS animeId, a.title, a.source_id AS sourceId, a.status';
    const statement =
      scope.kind === 'all'
        ? this.db.$client.prepare(`SELECT ${columns} FROM anime a WHERE a.in_library = 1 ORDER BY a.id`).all()
        : scope.kind === 'category'
          ? this.db.$client
              .prepare(
                `SELECT ${columns} FROM anime a
                 WHERE a.in_library = 1 AND a.id IN (SELECT anime_id FROM anime_categories WHERE category_id = ?)
                 ORDER BY a.id`,
              )
              .all(scope.categoryId)
          : this.db.$client.prepare(`SELECT ${columns} FROM anime a WHERE a.id = ?`).all(scope.animeId);
    return statement as UpdateTarget[];
  }

  /** History, sessions and episodes of the given anime, for the skip rules. */
  facts(animeIds: number[]): Map<number, AnimeFacts> {
    const facts = new Map<number, AnimeFacts>();
    if (animeIds.length === 0) return facts;
    const ids = JSON.stringify(animeIds);
    for (const id of animeIds) facts.set(id, { hasHistory: false, hasSession: false, episodes: [] });
    const rows = (sql: string) => this.db.$client.prepare(sql).raw(true).all({ ids }) as unknown[][];
    for (const [id] of rows('SELECT anime_id FROM history WHERE anime_id IN (SELECT value FROM json_each(@ids))') as [
      number,
    ][]) {
      const entry = facts.get(id);
      if (entry) entry.hasHistory = true;
    }
    for (const [id] of rows(
      'SELECT DISTINCT anime_id FROM watch_sessions WHERE anime_id IN (SELECT value FROM json_each(@ids))',
    ) as [number][]) {
      const entry = facts.get(id);
      if (entry) entry.hasSession = true;
    }
    for (const [id, animeId, number, watched, positionMs, sourceMissing] of rows(
      `SELECT id, anime_id, number, watched, position_ms, source_missing FROM episodes
       WHERE anime_id IN (SELECT value FROM json_each(@ids))`,
    ) as [number, number, number | null, number, number, number][]) {
      facts.get(animeId)?.episodes.push({
        id,
        number,
        watched: watched === 1,
        positionMs,
        sourceMissing: sourceMissing === 1,
      });
    }
    return facts;
  }

  /**
   * Records the outcome of a check. A failure keeps the previous `update_checked_at` (it is when the anime was
   * last reached) and stores the message for the Updates page (UPD-2); a success clears the message.
   */
  markChecked(animeId: number, at: number, error: string | null): void {
    this.db.$client
      .prepare(
        error === null
          ? 'UPDATE anime SET update_checked_at = ?, update_error = NULL WHERE id = ?'
          : 'UPDATE anime SET update_error = ? WHERE id = ?',
      )
      .run(error === null ? at : error.slice(0, 500), animeId);
    this.changes.emit('updates');
  }

  // ------------------------------------------------------------------ after a check (UPD-6)

  /** Title, number and source position of episodes by id, for grouping and for choosing what to download. */
  describeEpisodes(episodeIds: number[]): NewEpisodeInfo[] {
    if (episodeIds.length === 0) return [];
    return this.db.$client
      .prepare(
        `SELECT e.id AS episodeId, e.anime_id AS animeId, a.title AS animeTitle, e.number, e.source_order AS sourceOrder
         FROM episodes e JOIN anime a ON a.id = e.anime_id
         WHERE e.id IN (SELECT value FROM json_each(@ids)) ORDER BY e.anime_id, e.source_order`,
      )
      .all({ ids: JSON.stringify(episodeIds) }) as NewEpisodeInfo[];
  }

  /** Of these episodes, the ones without a download row. */
  withoutDownload(episodeIds: number[]): number[] {
    if (episodeIds.length === 0) return [];
    const rows = this.db.$client
      .prepare(
        `SELECT value AS id FROM json_each(@ids)
         WHERE value NOT IN (SELECT episode_id FROM downloads)`,
      )
      .all({ ids: JSON.stringify(episodeIds) }) as { id: number }[];
    return rows.map((row) => row.id);
  }

  /** The include/exclude mark of each category that has one (DL-11), from `categories.settings_json`. */
  autoDownloadModes(): Map<number, AutoDownloadMode> {
    const modes = new Map<number, AutoDownloadMode>();
    const rows = this.db.$client
      .prepare('SELECT id, settings_json AS json FROM categories WHERE settings_json IS NOT NULL')
      .all() as { id: number; json: string }[];
    for (const row of rows) {
      try {
        const value = (JSON.parse(row.json) as { autoDownload?: unknown } | null)?.autoDownload;
        if (value === 'include' || value === 'exclude') modes.set(row.id, value);
      } catch {
        // A damaged value reads as "no mark".
      }
    }
    return modes;
  }

  categoryIds(animeIds: number[]): Map<number, number[]> {
    const out = new Map<number, number[]>();
    if (animeIds.length === 0) return out;
    const rows = this.db.$client
      .prepare(
        'SELECT anime_id AS animeId, category_id AS categoryId FROM anime_categories WHERE anime_id IN (SELECT value FROM json_each(@ids))',
      )
      .all({ ids: JSON.stringify(animeIds) }) as { animeId: number; categoryId: number }[];
    for (const row of rows) out.set(row.animeId, [...(out.get(row.animeId) ?? []), row.categoryId]);
    return out;
  }

  // ------------------------------------------------------------------ url migration (UPD-6a)

  /**
   * The anime of one extension that someone still looks at, and their episodes, with the urls the extension
   * wrote: library entries, anime with watch history, and anime with downloads (an offline copy is opened
   * through the same url). Anime that were only seen in a listing are cache and are not migrated.
   */
  urlsOfExtension(extensionId: string): {
    anime: { id: number; sourceId: string; url: string }[];
    episodes: { id: number; sourceId: string; url: string }[];
  } {
    const params = { extensionId };
    const kept = `a.in_library = 1
      OR EXISTS (SELECT 1 FROM history h WHERE h.anime_id = a.id)
      OR EXISTS (SELECT 1 FROM downloads d JOIN episodes de ON de.id = d.episode_id WHERE de.anime_id = a.id)`;
    const anime = this.db.$client
      .prepare(
        `SELECT a.id, a.source_id AS sourceId, a.url FROM anime a
         JOIN sources s ON s.id = a.source_id WHERE s.extension_id = @extensionId AND (${kept})`,
      )
      .all(params) as { id: number; sourceId: string; url: string }[];
    const episodes = this.db.$client
      .prepare(
        `SELECT e.id, a.source_id AS sourceId, e.url FROM episodes e
         JOIN anime a ON a.id = e.anime_id JOIN sources s ON s.id = a.source_id
         WHERE s.extension_id = @extensionId AND (${kept})`,
      )
      .all(params) as { id: number; sourceId: string; url: string }[];
    return { anime, episodes };
  }

  /** Rewrites a stored url. False if another row already has the new one (the unique index), nothing changes then. */
  rewriteUrl(kind: 'anime' | 'episode', id: number, url: string): boolean {
    try {
      this.db.$client
        .prepare(
          kind === 'anime' ? 'UPDATE anime SET url = ? WHERE id = ?' : 'UPDATE episodes SET url = ? WHERE id = ?',
        )
        .run(url, id);
      return true;
    } catch (error) {
      if ((error as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT')) return false;
      throw error;
    }
  }
}
