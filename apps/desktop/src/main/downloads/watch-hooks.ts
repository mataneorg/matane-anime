// Download ahead (docs/PRD.md DL-12) and delete after watched (DL-13): downloads that follow what is being
// watched. They observe `WatchService` and act through `DownloadService`; they never write progress (ADR 0015).

import type { AnimeRepository } from '../db/repositories/anime';
import type { DownloadsRepository } from '../db/repositories/downloads';
import type { EpisodeRecord, EpisodesRepository } from '../db/repositories/episodes';
import type { SettingsRepository } from '../db/repositories/settings';
import type { PlaybackRef, WatchService } from '../watch/service';

export type RuleEpisode = Pick<
  EpisodeRecord,
  'id' | 'number' | 'variant' | 'sourceOrder' | 'watched' | 'sourceMissing'
>;

const byNumber = <T extends { number: number | null }>(episodes: T[]): Map<number, T[]> => {
  const groups = new Map<number, T[]>();
  for (const episode of episodes) {
    if (episode.number === null) continue;
    groups.set(episode.number, [...(groups.get(episode.number) ?? []), episode]);
  }
  return groups;
};

/**
 * The episodes to download while `playingId` plays. The window is the next `count` episode numbers after the
 * playing one (numbers the source still lists; gaps do not count). Inside it, a number is left out when any
 * variant of it is watched or has a download row (any status, an errored one included, so a failing episode
 * is not retried on every play). One copy per number: the playing episode's variant when that number has it,
 * else the one the source lists first. An episode without a number has no "next", so nothing follows it.
 */
export function selectAhead(
  episodes: RuleEpisode[],
  playingId: number,
  count: number,
  hasDownload: (episodeId: number) => boolean,
): number[] {
  const playing = episodes.find((episode) => episode.id === playingId);
  if (!playing || playing.number === null || count < 1) return [];
  const playingNumber = playing.number;
  const groups = byNumber(episodes);
  const window = [...groups.entries()]
    .filter(([number, group]) => number > playingNumber && group.some((episode) => !episode.sourceMissing))
    .sort(([a], [b]) => a - b)
    .slice(0, count);
  const picked: number[] = [];
  for (const [, group] of window) {
    if (group.some((episode) => episode.watched || hasDownload(episode.id))) continue;
    const available = group.filter((episode) => !episode.sourceMissing).sort((a, b) => a.sourceOrder - b.sourceOrder);
    const choice = available.find((episode) => episode.variant === playing.variant) ?? available[0];
    if (choice) picked.push(choice.id);
  }
  return picked;
}

/**
 * The episodes whose downloads go once they are watched. Episodes are ordered by number (distinct numbers,
 * so gaps and halves like 5.5 are one step each, and Sub/Dub of a number are one step). With `newest` the
 * latest watched number, a watched episode goes when it is at least `delay` steps behind it:
 *
 * - delay 0: right when it is watched, the newest one included;
 * - delay 1 ("After 1 more"): once the next episode is watched too (watching 3 releases 2, not 3).
 *
 * Episodes that are not watched are never listed. An episode without a number has no position to measure
 * from, so it goes only with delay 0.
 */
export function selectDeletable(
  episodes: RuleEpisode[],
  delay: number,
  hasDownload: (episodeId: number) => boolean,
): number[] {
  const numbers = [...byNumber(episodes).keys()].sort((a, b) => a - b);
  const step = new Map(numbers.map((number, index) => [number, index]));
  const newest = Math.max(
    -1,
    ...episodes
      .filter((episode) => episode.watched && episode.number !== null)
      .map((e) => step.get(e.number as number)!),
  );
  return episodes
    .filter((episode) => {
      if (!episode.watched || !hasDownload(episode.id)) return false;
      if (episode.number === null) return delay === 0;
      return newest - (step.get(episode.number) as number) >= delay;
    })
    .map((episode) => episode.id);
}

export interface WatchDownloadsDeps {
  settings: Pick<SettingsRepository, 'getAppSettings'>;
  episodes: Pick<EpisodesRepository, 'get' | 'list'>;
  anime: Pick<AnimeRepository, 'get'>;
  downloads: Pick<DownloadsRepository, 'byEpisode'>;
  categoryIdsOf(animeId: number): number[];
  /** `DownloadService.enqueue(…, { reason: 'ahead' })`. */
  enqueueAhead(episodeIds: number[]): Promise<unknown>;
  /** `DownloadService.remove`: the files and the row. */
  removeDownload(downloadId: number): Promise<void>;
  log?(message: string, error?: unknown): void;
}

export class WatchDownloads {
  /** What is playing now, so a file is never deleted under the player. */
  private readonly playing = new Map<string, number>();
  /** Runs one job at a time: two quick triggers must not both queue the same episode. */
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: WatchDownloadsDeps) {}

  /** Starts observing. Returns the function that stops it. */
  attach(watch: Pick<WatchService, 'onWatched' | 'onPlayStarted' | 'onPlayClosed'>): () => void {
    const stops = [
      watch.onPlayStarted((playback) => this.playStarted(playback)),
      watch.onWatched((episodeIds) => this.watched(episodeIds)),
      watch.onPlayClosed((playback) => this.playClosed(playback)),
    ];
    return () => stops.forEach((stop) => stop());
  }

  /** Resolves when everything triggered so far has finished (for tests). */
  idle(): Promise<void> {
    return this.chain;
  }

  private run(job: () => Promise<void>): void {
    this.chain = this.chain.then(job).catch((error: unknown) => this.deps.log?.('watch-driven download failed', error));
  }

  playStarted({ playbackId, episodeId }: PlaybackRef): void {
    this.playing.set(playbackId, episodeId);
    this.run(() => this.ahead(episodeId));
  }

  playClosed({ playbackId, episodeId }: PlaybackRef): void {
    this.playing.delete(playbackId);
    // A file kept because it was playing goes now if it was watched.
    this.run(() => this.cleanup(this.animeOf([episodeId])));
  }

  watched(episodeIds: number[]): void {
    this.run(() => this.cleanup(this.animeOf(episodeIds)));
  }

  private animeOf(episodeIds: number[]): number[] {
    return [...new Set(episodeIds.flatMap((id) => this.deps.episodes.get(id)?.animeId ?? []))];
  }

  private hasDownload = (episodeId: number): boolean => this.deps.downloads.byEpisode(episodeId) !== undefined;

  private async ahead(episodeId: number): Promise<void> {
    const settings = this.deps.settings.getAppSettings();
    if (!settings.downloadAhead) return;
    const episode = this.deps.episodes.get(episodeId);
    if (!episode || !this.deps.anime.get(episode.animeId)?.inLibrary) return;
    const picked = selectAhead(
      this.deps.episodes.list(episode.animeId),
      episodeId,
      settings.downloadAheadCount,
      this.hasDownload,
    );
    if (picked.length > 0) await this.deps.enqueueAhead(picked);
  }

  private async cleanup(animeIds: number[]): Promise<void> {
    const settings = this.deps.settings.getAppSettings();
    if (!settings.deleteAfterWatched) return;
    const excluded = new Set(settings.deleteAfterWatchedExcludedCategories);
    for (const animeId of animeIds) {
      if (this.deps.categoryIdsOf(animeId).some((id) => excluded.has(id))) continue;
      const playing = new Set(this.playing.values());
      const doomed = selectDeletable(
        this.deps.episodes.list(animeId),
        settings.deleteAfterWatchedDelay,
        this.hasDownload,
      ).filter((id) => !playing.has(id));
      for (const id of doomed) {
        const row = this.deps.downloads.byEpisode(id);
        if (row) await this.deps.removeDownload(row.id);
      }
    }
  }
}
