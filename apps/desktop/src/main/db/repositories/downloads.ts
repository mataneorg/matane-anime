import type { DownloadItem, DownloadStorage } from '@matane-anime/shared';
import { asc, eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { downloads } from '../schema';
import type { ChangeEmitter } from './changes';

export type DownloadRecord = typeof downloads.$inferSelect;
/** What the engine writes while it works; everything but the identity of the row. */
export type DownloadPatch = Partial<Omit<DownloadRecord, 'id' | 'episodeId' | 'createdAt'>>;

type Row = Omit<DownloadItem, 'hasLocalCover'> & { hasLocalCover: number };

/** The download queue and what was saved (docs/PRD.md DL-1…8). Files are the DownloadService's business. */
export class DownloadsRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: ChangeEmitter,
  ) {}

  get(id: number) {
    return this.db.select().from(downloads).where(eq(downloads.id, id)).get();
  }

  byEpisode(episodeId: number) {
    return this.db.select().from(downloads).where(eq(downloads.episodeId, episodeId)).get();
  }

  /** Raw rows in queue order, the finished ones included. */
  all(): DownloadRecord[] {
    return this.db.select().from(downloads).orderBy(asc(downloads.queueOrder), asc(downloads.id)).all();
  }

  /** The next download waiting its turn. */
  nextQueued(): DownloadRecord | undefined {
    return this.db
      .select()
      .from(downloads)
      .where(eq(downloads.status, 'queued'))
      .orderBy(asc(downloads.queueOrder), asc(downloads.id))
      .get();
  }

  /** A new download goes to the end of the queue. */
  insert(input: { episodeId: number; kind: DownloadRecord['kind']; sizeBytes: number | null; now: number }): number {
    const row = this.db
      .insert(downloads)
      .values({
        episodeId: input.episodeId,
        kind: input.kind,
        sizeBytes: input.sizeBytes,
        status: 'queued',
        queueOrder: this.nextQueueOrder(),
        createdAt: input.now,
      })
      .returning({ id: downloads.id })
      .get();
    this.notify();
    return row.id;
  }

  nextQueueOrder(): number {
    const row = this.db.$client.prepare('SELECT COALESCE(MAX(queue_order), 0) + 1 AS next FROM downloads').get() as {
      next: number;
    };
    return row.next;
  }

  /** `silent` for the routine saving of progress, which reaches the renderer as events instead. */
  update(id: number, patch: DownloadPatch, options: { silent?: boolean } = {}): void {
    if (Object.keys(patch).length === 0) return;
    this.db.update(downloads).set(patch).where(eq(downloads.id, id)).run();
    if (!options.silent) this.notify();
  }

  delete(ids: number[]): void {
    if (ids.length === 0) return;
    this.db.transaction((tx) => {
      for (const id of ids) tx.delete(downloads).where(eq(downloads.id, id)).run();
    });
    this.notify();
  }

  /** After a crash or a quit: what was running waits in the queue again. */
  recoverInterrupted(): number {
    const result = this.db.$client.prepare("UPDATE downloads SET status = 'queued' WHERE status = 'downloading'").run();
    if (result.changes > 0) this.notify();
    return result.changes;
  }

  /**
   * Puts the listed downloads in that order, in the places they held. Others keep theirs, so a queue shown
   * with a filter is reordered without moving what is hidden.
   */
  reorder(ids: number[]): void {
    const rows = ids.flatMap((id) => {
      const row = this.get(id);
      return row ? [row] : [];
    });
    const slots = rows.map((row) => row.queueOrder).sort((a, b) => a - b);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = ids.flatMap((id) => (byId.has(id) ? [id] : []));
    this.db.transaction((tx) => {
      ordered.forEach((id, index) => {
        tx.update(downloads)
          .set({ queueOrder: slots[index] as number })
          .where(eq(downloads.id, id))
          .run();
      });
    });
    this.notify();
  }

  /** New location for finished downloads, all or nothing (changing the download folder). */
  rewritePaths(updates: { id: number; path: string }[]): void {
    this.db.transaction((tx) => {
      for (const { id, path } of updates) tx.update(downloads).set({ path }).where(eq(downloads.id, id)).run();
    });
    this.notify();
  }

  /**
   * What the downloads take or will take: bytes saved by every one, plus the estimate still to come for those
   * that are not done. The size limit is checked against this (DL-10), so a long queue counts at once.
   */
  committedBytes(): number {
    const row = this.db.$client
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN status = 'done' THEN bytes_done ELSE MAX(bytes_done, COALESCE(size_bytes, 0)) END), 0)
                AS total FROM downloads`,
      )
      .get() as { total: number };
    return row.total;
  }

  /** Every download with what the Downloads page shows for it: the queue first, then the finished ones. */
  list(): DownloadItem[] {
    const rows = this.db.$client
      .prepare(
        `SELECT d.id, d.episode_id AS episodeId, e.anime_id AS animeId, a.source_id AS sourceId, s.name AS sourceName,
                a.title AS animeTitle, a.thumbnail_url AS thumbnailUrl, a.cover_path IS NOT NULL AS hasLocalCover,
                e.number AS episodeNumber, e.name AS episodeName, d.status, d.queue_order AS queueOrder, d.kind,
                d.segments_done AS segmentsDone, d.segments_total AS segmentsTotal, d.bytes_done AS bytesDone,
                d.size_bytes AS sizeBytes, d.quality, d.server, d.error, d.created_at AS createdAt,
                d.completed_at AS completedAt
         FROM downloads d
         JOIN episodes e ON e.id = d.episode_id
         JOIN anime a ON a.id = e.anime_id
         LEFT JOIN sources s ON s.id = a.source_id
         ORDER BY d.status = 'done', d.queue_order, d.id`,
      )
      .all() as Row[];
    return rows.map((row) => ({ ...row, hasLocalCover: row.hasLocalCover === 1 }));
  }

  /** Bytes the finished downloads take, against the size limit (DL-10). Unfinished ones count what they saved. */
  usedBytes(): number {
    const row = this.db.$client.prepare('SELECT COALESCE(SUM(bytes_done), 0) AS total FROM downloads').get() as {
      total: number;
    };
    return row.total;
  }

  counts(): DownloadStorage['counts'] {
    const counts = { downloading: 0, queued: 0, paused: 0, error: 0, done: 0 };
    const rows = this.db.$client.prepare('SELECT status, COUNT(*) AS n FROM downloads GROUP BY status').all() as {
      status: keyof typeof counts;
      n: number;
    }[];
    for (const row of rows) counts[row.status] = row.n;
    return counts;
  }

  notify(): void {
    this.changes.emit('downloads');
  }
}
