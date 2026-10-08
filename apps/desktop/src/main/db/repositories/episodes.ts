import type { Episode } from '@matane-anime/extension-sdk';
import { and, asc, eq, gt, inArray as inArrayOf, isNull, lt } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { episodes } from '../schema';
import type { ChangeEmitter } from './changes';

export type EpisodeRecord = typeof episodes.$inferSelect;

export interface SyncResult {
  added: number;
  missing: number;
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
   * ones keep their progress. Episodes that dropped out are marked `sourceMissing`, not deleted: whether
   * to delete them depends on progress and downloads (UPD-5, phase 3). An **empty list changes nothing**,
   * since a site that fails to render must not wipe a library.
   */
  sync(animeId: number, list: Episode[], now = Date.now()): SyncResult {
    if (list.length === 0) return { added: 0, missing: 0, latestUploadedAt: undefined };
    // A url listed twice counts once, at its first (newest) position.
    const unique = list.filter((episode, index) => list.findIndex((other) => other.url === episode.url) === index);
    let added = 0;
    let missing = 0;
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
          tx.insert(episodes)
            .values({
              animeId,
              url: episode.url,
              fetchedAt: now,
              ...fields,
              ...(inherited && { watched: true, watchedAt: now }),
            })
            .run();
          added++;
        }
      });
      for (const gone of existing.values()) {
        if (!gone.sourceMissing) missing++;
        tx.update(episodes).set({ sourceMissing: true }).where(eq(episodes.id, gone.id)).run();
      }
    });
    this.changes.emit(`episodes:${animeId}`);
    const uploaded = unique.map((episode) => episode.uploadedAt).filter((at): at is number => at !== undefined);
    return { added, missing, latestUploadedAt: uploaded.length ? Math.max(...uploaded) : undefined };
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
