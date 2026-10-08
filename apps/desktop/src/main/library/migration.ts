import { AppError, type MigrationPreview } from '@matane-anime/shared';
import type { AnimeRepository } from '../db/repositories/anime';
import type { EpisodeRecord, EpisodesRepository } from '../db/repositories/episodes';
import type { LibraryRepository } from '../db/repositories/library';
import { type MatchEpisode, type OldEpisode, hasProgress, planMigration } from './match';

export interface MigrationDeps {
  anime: AnimeRepository;
  episodes: EpisodesRepository;
  library: LibraryRepository;
  /** Fetches an anime's details and episodes from its source (the same call as the detail page's refresh). */
  refresh(animeId: number, requestId?: string): Promise<unknown>;
  /** Called after a migration: the new entry needs its permanent cover and the old one's is no longer needed. */
  afterMigrate?(fromId: number, toId: number): void;
}

const asMatch = (row: EpisodeRecord): MatchEpisode => ({
  id: row.id,
  number: row.number,
  variant: row.variant,
  name: row.name,
  sourceOrder: row.sourceOrder,
});
const asOld = (row: EpisodeRecord): OldEpisode => ({
  ...asMatch(row),
  watched: row.watched,
  watchedAt: row.watchedAt,
  positionMs: row.positionMs,
  durationMs: row.durationMs,
});

/** Moving an anime to the same series on another source, keeping what was watched (docs/PRD.md BRW-8). */
export class MigrationService {
  private readonly deps: MigrationDeps;

  constructor(deps: MigrationDeps) {
    this.deps = deps;
  }

  private check(fromId: number, toId: number): void {
    if (fromId === toId) throw new AppError('invalid_input', 'Choose another anime to migrate to');
    if (!this.deps.anime.get(fromId) || !this.deps.anime.get(toId))
      throw new AppError('not_found', 'That anime is no longer there');
  }

  private plan(fromId: number, toId: number) {
    const previous = this.deps.episodes.list(fromId).map(asOld);
    const current = this.deps.episodes.list(toId).map(asMatch);
    return { previous, current, plan: planMigration(previous, current) };
  }

  /** Fetches the new anime's episodes, then says what would carry over. Nothing is changed. */
  async preview(fromId: number, toId: number, requestId?: string): Promise<MigrationPreview> {
    this.check(fromId, toId);
    await this.deps.refresh(toId, requestId);
    const { previous, plan } = this.plan(fromId, toId);
    return {
      withProgress: previous.filter(hasProgress).length,
      matched: plan.transfers.reduce((sum, transfer) => sum + transfer.from.length, 0),
      unmatched: plan.unmatched.map((episode) => ({
        episodeId: episode.id,
        number: episode.number,
        name: episode.name,
      })),
    };
  }

  async migrate(fromId: number, toId: number): Promise<{ animeId: number; carried: number }> {
    this.check(fromId, toId);
    if (this.deps.episodes.list(toId).length === 0) await this.deps.refresh(toId);
    const { plan } = this.plan(fromId, toId);
    const carried = this.deps.library.migrate(fromId, toId, plan);
    this.deps.afterMigrate?.(fromId, toId);
    return { animeId: toId, carried };
  }
}
