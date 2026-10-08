import type { Episode } from '@matane-anime/extension-sdk';
import { and, asc, eq, gt, inArray as inArrayOf, isNull, lt } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { episodes } from '../schema';
import type { ChangeEmitter } from './changes';

export type EpisodeRecord = typeof episodes.$inferSelect;

export interface SyncResult {
  /** Rows inserted, including ones that arrived already watched because another variant of the number was. */
  added: number;
  /** Ids of the inserted rows that are still unwatched: what the update checker reports as new. */
  addedIds: number[];
  /** Episodes that just dropped out of the source and were kept (flagged `sourceMissing`). */
  missing: number;
  /** Episodes that dropped out of the source and were deleted (UPD-5). */
  removed: number;
  latestUploadedAt: number | undefined;
}

export class EpisodesRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: ChangeEmitter,
  ) {}

  /** In the source's order (newest first, as the extension returned them). */
  list(animeId: number): EpisodeRecord[] {
    return this.db
      .select()
      .from(episodes)
      .where(eq(episodes.animeId, animeId))
      .orderBy(asc(episodes.sourceOrder))
      .all();
  }

  get(id: number): EpisodeRecord | undefined {
    return this.db.select().from(episodes).where(eq(episodes.id, id)).get();
  }

  /**
   * Brings the stored episodes in line with the list the source returned. New urls are inserted (and are
   * the only ones that get `fetchedAt = now`, which is what makes an episode "new" later, UPD-4); known
   * ones keep their progress. Episodes that dropped out are deleted unless something of the user's hangs
   * on them (UPD-5): watched, a saved position, a download, a history entry or a watch session. Those stay,
   * flagged `sourceMissing`. An **empty list changes nothing**, since a site that fails to render must not
   * wipe a library.
   *
   * `baselineAt` is for an anime that is already in the library but was never fetched: its first episode list
   * is what existed when it was added, so those rows get `fetchedAt <= baselineAt` and never count as new.
   */
  sync(animeId: number, list: Episode[], now = Date.now(), baselineAt?: number): SyncResult {
    if (list.length === 0) return { added: 0, addedIds: [], missing: 0, removed: 0, latestUploadedAt: undefined };
    // A url listed twice counts once, at its first (newest) position.
    const unique = list.filter((episode, index) => list.findIndex((other) => other.url === episode.url) === index);
    const fetchedAt = baselineAt === undefined ? now : Math.min(now, baselineAt);
    const addedIds: number[] = [];
    let added = 0;
    let missing = 0;
    let removed = 0;
    this.db.transaction((tx) => {
      const existing = new Map(
        tx
          .select()
          .from(episodes)
          .where(eq(episodes.animeId, animeId))
          .all()
          .map((row) => [row.url, row]),
      );
      // A number that is already watched stays watched when a new variant of it appears (PRG-5).
      const watchedNumbers = new Set(
        [...existing.values()].filter((row) => row.watched && row.number !== null).map((row) => row.number),
      );
      unique.forEach((episode, order) => {
        const fields = {
          name: episode.name,
          number: episode.number ?? null,
          variant: episode.variant ?? null,
          uploadedAt: episode.uploadedAt ?? null,
          sourceOrder: order,
          sourceMissing: false,
        };
        if (existing.has(episode.url)) {
          tx.update(episodes)
            .set(fields)
            .where(eq(episodes.id, (existing.get(episode.url) as EpisodeRecord).id))
            .run();
          existing.delete(episode.url);
        } else {
          const inherited = episode.number !== undefined && watchedNumbers.has(episode.number);
          const { id } = tx
            .insert(episodes)
            .values({
              animeId,
              url: episode.url,
              fetchedAt,
              ...fields,
              ...(inherited && { watched: true, watchedAt: now }),
            })
            .returning({ id: episodes.id })
            .get();
          added++;
          if (!inherited) addedIds.push(id);
        }
      });
      const gone = [...existing.values()];
      const kept = this.referenced(gone.filter((row) => !row.watched && row.positionMs === 0).map((row) => row.id));
      for (const row of gone) {
        if (row.watched || row.positionMs > 0 || kept.has(row.id)) {
          if (!row.sourceMissing) missing++;
          tx.update(episodes).set({ sourceMissing: true }).where(eq(episodes.id, row.id)).run();
        } else {
          tx.delete(episodes).where(eq(episodes.id, row.id)).run();
          removed++;
        }
      }
    });
    this.changes.emit(`episodes:${animeId}`, ...(added + missing + removed > 0 ? ['updates'] : []));
    const uploaded = unique.map((episode) => episode.uploadedAt).filter((at): at is number => at !== undefined);
    return { added, addedIds, missing, removed, latestUploadedAt: uploaded.length ? Math.max(...uploaded) : undefined };
  }

  /** Which of these episodes a download, the history or a watch session points at. Read-only (ADR 0015). */
  private referenced(ids: number[]): Set<number> {
    if (ids.length === 0) return new Set();
    const rows = this.db.$client
      .prepare(
        `SELECT episode_id AS id FROM downloads WHERE episode_id IN (SELECT value FROM json_each(@ids))
         UNION SELECT episode_id FROM history WHERE episode_id IN (SELECT value FROM json_each(@ids))
         UNION SELECT episode_id FROM watch_sessions WHERE episode_id IN (SELECT value FROM json_each(@ids))`,
      )
      .all({ ids: JSON.stringify(ids) }) as { id: number }[];
    return new Set(rows.map((row) => row.id));
  }

  // ------------------------------------------------------------------ progress (written only by WatchService, PRG-9)

  saveProgress(id: number, positionMs: number, durationMs: number | null): void {
    this.db
      .update(episodes)
      .set({ positionMs: Math.round(positionMs), ...(durationMs !== null && { durationMs: Math.round(durationMs) }) })
      .where(eq(episodes.id, id))
      .run();
  }

  /**
   * Marks episodes watched or not. Every variant with the same number follows (PRG-5); an episode without a
   * number is on its own. Marking unwatched also forgets the position, so it plays from the start. Returns the
   * anime that were touched.
   */
  setWatched(ids: number[], watched: boolean, now = Date.now()): number[] {
    const touched = new Set<number>();
    this.db.transaction((tx) => {
      for (const id of ids) {
        const row = tx.select().from(episodes).where(eq(episodes.id, id)).get();
        if (!row) continue;
        touched.add(row.animeId);
        const where =
          row.number !== null
            ? and(eq(episodes.animeId, row.animeId), eq(episodes.number, row.number))
            : eq(episodes.id, row.id);
        tx.update(episodes)
          .set(watched ? { watched: true, watchedAt: now } : { watched: false, watchedAt: null, positionMs: 0 })
          .where(where)
          .run();
      }
    });
    for (const animeId of touched) this.changes.emit(`episodes:${animeId}`, `anime:${animeId}`, 'library');
    return [...touched];
  }

  /** Everything before this episode in watching order becomes watched ("mark all previous", PRG-7). */
  markPrevious(id: number, now = Date.now()): number | undefined {
    const row = this.get(id);
    if (!row) return undefined;
    const before =
      row.number !== null
        ? and(eq(episodes.animeId, row.animeId), lt(episodes.number, row.number), eq(episodes.watched, false))
        : and(
            eq(episodes.animeId, row.animeId),
            isNull(episodes.number),
            gt(episodes.sourceOrder, row.sourceOrder),
            eq(episodes.watched, false),
          );
    this.db.update(episodes).set({ watched: true, watchedAt: now }).where(before).run();
    this.changes.emit(`episodes:${row.animeId}`, `anime:${row.animeId}`, 'library');
    return row.animeId;
  }

  resetProgress(id: number): number | undefined {
    const row = this.get(id);
    if (!row) return undefined;
    this.setWatched([id], false);
    return row.animeId;
  }

  /** Every episode of the given anime, with only what the library and history logic needs. */
  forAnime(animeIds: number[]): EpisodeRecord[] {
    if (animeIds.length === 0) return [];
    return this.db.select().from(episodes).where(inArrayOf(episodes.animeId, animeIds)).all();
  }
}
