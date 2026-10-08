import { eq, isNull, sql } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { watchSessions } from '../schema';

/** Time actually spent watching, kept for statistics after v1 (docs/PRD.md PRG-10). Separate from history. */
export class WatchSessionsRepository {
  constructor(private readonly db: AppDatabase) {}

  start(animeId: number, episodeId: number, now: number): number {
    return this.db
      .insert(watchSessions)
      .values({ animeId, episodeId, startedAt: now })
      .returning({ id: watchSessions.id })
      .get().id;
  }

  addActive(id: number, activeMs: number): void {
    this.db
      .update(watchSessions)
      .set({ activeMs: sql`${watchSessions.activeMs} + ${Math.round(activeMs)}` })
      .where(eq(watchSessions.id, id))
      .run();
  }

  end(id: number, now: number): void {
    this.db.update(watchSessions).set({ endedAt: now }).where(eq(watchSessions.id, id)).run();
  }

  /** After a crash or a forced quit sessions were left open: close them where their playing time ended. */
  closeStale(): number {
    return this.db
      .update(watchSessions)
      .set({ endedAt: sql`${watchSessions.startedAt} + ${watchSessions.activeMs}` })
      .where(isNull(watchSessions.endedAt))
      .run().changes;
  }

  get(id: number) {
    return this.db.select().from(watchSessions).where(eq(watchSessions.id, id)).get();
  }
}
