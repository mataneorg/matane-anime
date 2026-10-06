import type { Episode } from '@matane-anime/extension-sdk';
import { asc, eq } from 'drizzle-orm';
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
          tx.insert(episodes)
            .values({ animeId, url: episode.url, fetchedAt: now, ...fields })
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
}
