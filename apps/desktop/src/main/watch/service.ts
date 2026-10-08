import { AppError, type ContinueTarget, type HistoryEntry, type ProgressInput } from '@matane-anime/shared';
import type { AnimeRepository } from '../db/repositories/anime';
import type { ChangeEmitter } from '../db/repositories/changes';
import type { EpisodeRecord, EpisodesRepository } from '../db/repositories/episodes';
import type { HistoryRepository } from '../db/repositories/history';
import type { SettingsRepository } from '../db/repositories/settings';
import type { WatchSessionsRepository } from '../db/repositories/watch-sessions';
import { type ContinueEpisode, continueTarget } from './continue';
import { HISTORY_MIN_ACTIVE_MS, MAX_ACTIVE_STEP_MS, reachedThreshold, resumePosition } from './rules';

export interface WatchDeps {
  episodes: EpisodesRepository;
  anime: AnimeRepository;
  history: HistoryRepository;
  sessions: WatchSessionsRepository;
  settings: SettingsRepository;
  changes: ChangeEmitter;
  /** Incognito (docs/PRD.md PRG-11, UI in phase 5): while true, nothing is recorded automatically. */
  isIncognito?: () => boolean;
  now?: () => number;
}

interface ActiveSession {
  sessionId: number;
  animeId: number;
  episodeId: number;
  lastAt: number;
  activeMs: number;
  playing: boolean;
  /** Whether `onPlayStarted` listeners were told about this playback. */
  announced: boolean;
}

/** A playback, as the observers of `WatchService` see it. */
export interface PlaybackRef {
  playbackId: string;
  episodeId: number;
}

export function toContinueDto(target: {
  episode: ContinueEpisode & { name?: string };
  reason: ContinueTarget['reason'];
  resumeMs: number;
}): ContinueTarget {
  return {
    episodeId: target.episode.id,
    number: target.episode.number,
    name: target.episode.name ?? '',
    reason: target.reason,
    resumeMs: target.resumeMs,
  };
}

const asContinueEpisode = (row: EpisodeRecord): ContinueEpisode & { name: string } => ({
  id: row.id,
  number: row.number,
  variant: row.variant,
  sourceOrder: row.sourceOrder,
  watched: row.watched,
  positionMs: row.positionMs,
  durationMs: row.durationMs,
  sourceMissing: row.sourceMissing,
  name: row.name,
});

/**
 * The single door for everything about what was watched (docs/PRD.md PRG-9): positions, the watched flag,
 * history and watch sessions are written here and nowhere else. The renderer keeps sending reports and does
 * not know the rules (threshold, what counts as playing, when history is touched).
 */
export class WatchService {
  private readonly active = new Map<string, ActiveSession>();
  private readonly deps: WatchDeps;
  private readonly watchedListeners = new Set<(episodeIds: number[]) => void>();
  private readonly startedListeners = new Set<(playback: PlaybackRef) => void>();
  private readonly closedListeners = new Set<(playback: PlaybackRef) => void>();

  constructor(deps: WatchDeps) {
    this.deps = deps;
    // Sessions left open by a crash or a forced quit end where their playing time ended.
    deps.sessions.closeStale();
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private threshold(): number {
    return this.deps.settings.getAppSettings().playerWatchedThreshold;
  }

  // ------------------------------------------------------------------ observers
  // Hooks for features that react to watching (download ahead, delete after watched). They only observe: the
  // progress, the watched flag and the history are still written here and nowhere else (docs/adr/0015).

  /** Called with the episodes that just turned watched: by the threshold, an ending, or marking by hand. */
  onWatched(listener: (episodeIds: number[]) => void): () => void {
    this.watchedListeners.add(listener);
    return () => this.watchedListeners.delete(listener);
  }

  /** Called once per playback, at its first `play` report. */
  onPlayStarted(listener: (playback: PlaybackRef) => void): () => void {
    this.startedListeners.add(listener);
    return () => this.startedListeners.delete(listener);
  }

  /** Called when a playback reports `close`. */
  onPlayClosed(listener: (playback: PlaybackRef) => void): () => void {
    this.closedListeners.add(listener);
    return () => this.closedListeners.delete(listener);
  }

  /** A listener that throws must never break progress saving. */
  private notify<T>(listeners: Set<(value: T) => void>, value: T): void {
    for (const listener of listeners) {
      try {
        listener(value);
      } catch {
        // observers handle their own errors
      }
    }
  }

  /** Runs a write that can mark episodes watched and tells the observers which ones it turned. */
  private trackWatched(animeIds: number[], write: () => void): void {
    const unwatched = () =>
      this.deps.episodes
        .forAnime(animeIds)
        .filter((episode) => !episode.watched)
        .map((episode) => episode.id);
    const before = this.watchedListeners.size > 0 ? unwatched() : [];
    write();
    if (before.length === 0) return;
    const still = new Set(unwatched());
    const turned = before.filter((id) => !still.has(id));
    if (turned.length > 0) this.notify(this.watchedListeners, turned);
  }

  /** Where playback of an episode starts (PRG-4). */
  resumeFor(episode: EpisodeRecord): number {
    return resumePosition(episode, this.threshold());
  }

  progress(input: ProgressInput): { watched: boolean } {
    const { episodes, history, sessions, changes } = this.deps;
    const episode = episodes.get(input.episodeId);
    if (!episode) throw new AppError('not_found', `No episode ${input.episodeId}`);
    if (this.deps.isIncognito?.()) return { watched: episode.watched };

    const now = this.now();
    let session = this.active.get(input.playbackId);
    if (!session) {
      session = {
        sessionId: sessions.start(episode.animeId, episode.id, now),
        animeId: episode.animeId,
        episodeId: episode.id,
        lastAt: now,
        activeMs: 0,
        playing: false,
        announced: false,
      };
      this.active.set(input.playbackId, session);
    }
    // Playing time counts only between a report that said "playing" and the next one, and a stall is capped.
    if (session.playing) {
      const step = Math.min(Math.max(now - session.lastAt, 0), MAX_ACTIVE_STEP_MS);
      session.activeMs += step;
      sessions.addActive(session.sessionId, step);
    }
    session.lastAt = now;
    if (input.reason === 'play' || input.reason === 'heartbeat') session.playing = true;
    if (input.reason === 'pause' || input.reason === 'ended' || input.reason === 'close') session.playing = false;

    const duration = input.durationMs ?? episode.durationMs;
    const ended = input.reason === 'ended';
    episodes.saveProgress(episode.id, ended && duration !== null ? duration : input.positionMs, input.durationMs);

    let watched = episode.watched;
    if (!watched && reachedThreshold(input.positionMs, duration, this.threshold(), ended)) {
      episodes.setWatched([episode.id], true, now);
      watched = true;
      this.notify(this.watchedListeners, [episode.id]);
    }

    if (session.activeMs >= HISTORY_MIN_ACTIVE_MS) {
      const previous = history.get(episode.animeId);
      history.touch(episode.animeId, episode.id, now, previous?.episodeId !== episode.id);
    }
    if (input.reason !== 'heartbeat' && input.reason !== 'play') {
      changes.emit(`episodes:${episode.animeId}`, `anime:${episode.animeId}`, 'library', 'history');
    }
    if (input.reason === 'play' && !session.announced) {
      session.announced = true;
      this.notify(this.startedListeners, { playbackId: input.playbackId, episodeId: episode.id });
    }
    if (input.reason === 'close') {
      sessions.end(session.sessionId, now);
      this.active.delete(input.playbackId);
      this.notify(this.closedListeners, { playbackId: input.playbackId, episodeId: episode.id });
    }
    return { watched };
  }

  markWatched(episodeIds: number[], watched: boolean): void {
    const write = () => this.deps.episodes.setWatched(episodeIds, watched, this.now());
    if (!watched) return void write();
    const animeIds = [...new Set(episodeIds.flatMap((id) => this.deps.episodes.get(id)?.animeId ?? []))];
    this.trackWatched(animeIds, write);
  }

  /** Every episode of these anime (the library's multi-select, LIB-5). */
  markAnimeWatched(animeIds: number[], watched: boolean): void {
    const write = () =>
      this.deps.episodes.setWatched(
        this.deps.episodes.forAnime(animeIds).map((episode) => episode.id),
        watched,
        this.now(),
      );
    if (!watched) return void write();
    this.trackWatched(animeIds, write);
  }

  markPrevious(episodeId: number): void {
    const animeId = this.deps.episodes.get(episodeId)?.animeId;
    const write = () => this.deps.episodes.markPrevious(episodeId, this.now());
    if (animeId === undefined) return void write();
    this.trackWatched([animeId], write);
  }

  resetProgress(episodeId: number): void {
    this.deps.episodes.resetProgress(episodeId);
  }

  /** What "Continue" opens for an anime (PRG-6). */
  continueTarget(animeId: number): ContinueTarget | null {
    const rows = this.deps.episodes.list(animeId);
    const target = continueTarget(
      rows.map(asContinueEpisode),
      this.deps.history.get(animeId)?.episodeId ?? null,
      this.threshold(),
    );
    return target ? toContinueDto(target) : null;
  }

  // ------------------------------------------------------------------ history (PRG-8)

  listHistory(): HistoryEntry[] {
    const rows = this.deps.history.listWithContext();
    const byAnime = new Map<number, EpisodeRecord[]>();
    for (const episode of this.deps.episodes.forAnime(rows.map((row) => row.animeId))) {
      const list = byAnime.get(episode.animeId) ?? [];
      list.push(episode);
      byAnime.set(episode.animeId, list);
    }
    const threshold = this.threshold();
    return rows.map((row) => {
      const target = continueTarget((byAnime.get(row.animeId) ?? []).map(asContinueEpisode), row.episodeId, threshold);
      return { ...row, next: target ? toContinueDto(target) : null };
    });
  }

  deleteHistory(animeId: number): void {
    this.deps.history.delete(animeId);
  }

  clearHistory(): void {
    this.deps.history.clear();
  }
}
