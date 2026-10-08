import type { DownloadItem, DownloadStorage } from '@matane-anime/shared';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { downloads } from '../schema';
import type { ChangeEmitter } from './changes';

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
