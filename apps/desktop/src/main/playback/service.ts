import { randomBytes } from 'node:crypto';
import {
  AppError,
  type EpisodeRef,
  type PlaybackEvent,
  type PlaybackSession as PlaybackSessionDto,
  type PlaybackUpdate,
  type StreamOption,
} from '@matane-anime/shared';
import { powerSaveBlocker } from 'electron';
import type { AnimeRepository, AnimeRow } from '../db/repositories/anime';
import type { EpisodeRecord, EpisodesRepository } from '../db/repositories/episodes';
import type { ExtensionStore } from '../db/repositories/extension-store';
import type { SettingsRepository } from '../db/repositories/settings';
import type { ExtensionService } from '../extensions/service';
import { abortable, type RequestRegistry } from '../ipc/requests';
import { neighbors } from './neighbors';
import { type ProbeResult, probeStream } from './probe';
import type { UpstreamFetch } from './proxy';
import { type Ranked, guessKind, rankStreams } from './ranking';
import type { SessionStore } from './sessions';

/** Playback errors tolerated before the player shows the error state (docs/PRD.md STR-3). */
export const MAX_ATTEMPTS = 3;
const lastServerKey = (sourceId: string): string => `playback.lastServer.${sourceId}`;

export interface PlaybackDeps {
  extensions: ExtensionService;
  anime: AnimeRepository;
  episodes: EpisodesRepository;
  settings: SettingsRepository;
  store: ExtensionStore;
  sessions: SessionStore;
  upstream: UpstreamFetch;
  requests: RequestRegistry;
}

interface Playback {
  id: string;
  episode: EpisodeRecord;
  anime: AnimeRow;
  extensionId: string;
  candidates: Ranked[];
  /** Candidate positions that failed to probe or to play. */
  failed: Set<number>;
  active: number;
  kind: 'hls' | 'mp4';
  sessionId: string | null;
  url: string;
  attempts: number;
  /** `getStreams` was called again for an expired link; it is only worth doing once. */
  refreshed: boolean;
  /** Every server tried, in order, for the error state. */
  tried: string[];
  /** Serializes calls: a stream can raise several errors at once. */
  lock: Promise<unknown>;
}

const label = (r: Ranked): string => `${r.stream.server}${r.stream.quality ? ` ${r.stream.quality}p` : ''}`;

/**
 * Picks, probes and opens streams (docs/PRD.md §6.4, §8.3). The renderer only asks for an episode; main
 * decides which stream, checks that it answers, hands the player an `anime://` session, and when playback
 * breaks it moves to the next stream (or asks the extension for a fresh link) without the user doing
 * anything. Whatever the user picks by hand is remembered for the anime.
 */
export class PlaybackService {
  private readonly playbacks = new Map<string, Playback>();
  private blocker: number | null = null;
  private readonly deps: PlaybackDeps;

  constructor(deps: PlaybackDeps) {
    this.deps = deps;
  }

  async start(episodeId: number, requestId?: string): Promise<PlaybackSessionDto> {
    const request = this.deps.requests.begin(requestId);
    try {
      return await abortable(this.startInner(episodeId), request.signal);
    } finally {
      request.done();
    }
  }

  private async startInner(episodeId: number): Promise<PlaybackSessionDto> {
    const { episodes, anime, extensions } = this.deps;
    const episode = episodes.get(episodeId);
    if (!episode) throw new AppError('not_found', `No episode with id ${episodeId}`);
    const row = anime.get(episode.animeId);
    if (!row) throw new AppError('not_found', `No anime with id ${episode.animeId}`);
    extensions.assertAvailable(row.sourceId);
    // STR-7 (phase 3): a downloaded episode is played from disk before any stream is tried.

    const streams = await extensions.streamsFor(row, episode, false);
    const playback: Playback = {
      id: randomBytes(9).toString('base64url'),
      episode,
      anime: row,
      extensionId: row.sourceId.split('/')[0] as string,
      candidates: this.rank(row, streams),
      failed: new Set(),
      active: -1,
      kind: 'hls',
      sessionId: null,
      url: '',
      attempts: 0,
      refreshed: false,
      tried: [],
      lock: Promise.resolve(),
    };
    await this.openFirstWorking(
      playback,
      playback.candidates.map((_c, position) => position),
    );
    this.playbacks.set(playback.id, playback);
    return this.describe(playback);
  }

  /** The player reports a first frame (remember the server) or a fatal error (move on). */
  event(playbackId: string, event: PlaybackEvent): Promise<PlaybackUpdate> {
    const playback = this.require(playbackId);
    const run = playback.lock.then(() => this.handleEvent(playback, event));
    playback.lock = run.catch(() => undefined);
    return run;
  }

  /** The user chose a server or quality: that stream or an error, and the choice is remembered (STR-5). */
  async switchStream(playbackId: string, index: number, requestId?: string): Promise<PlaybackSessionDto> {
    const playback = this.require(playbackId);
    const request = this.deps.requests.begin(requestId);
    try {
      const run = playback.lock.then(async () => {
        const chosen = playback.candidates[index];
        if (!chosen) throw new AppError('invalid_input', `No stream ${index}`);
        playback.failed.delete(index);
        playback.attempts = 0;
        await this.openFirstWorking(playback, [index]);
        this.deps.anime.savePlaybackPrefs(playback.anime.id, {
          server: chosen.stream.server,
          quality: chosen.stream.quality ?? null,
        });
        return this.describe(playback);
      });
      playback.lock = run.catch(() => undefined);
      return await abortable(run, request.signal);
    } finally {
      request.done();
    }
  }

  close(playbackId: string): void {
    const playback = this.playbacks.get(playbackId);
    if (!playback) return;
    if (playback.sessionId) this.deps.sessions.delete(playback.sessionId);
    this.playbacks.delete(playbackId);
  }

  closeAll(): void {
    for (const id of [...this.playbacks.keys()]) this.close(id);
    this.keepAwake(false);
  }

  /** Keeps the display on while video plays (PLY-8). */
  keepAwake(enabled: boolean): void {
    if (enabled && this.blocker === null) this.blocker = powerSaveBlocker.start('prevent-display-sleep');
    if (!enabled && this.blocker !== null) {
      powerSaveBlocker.stop(this.blocker);
      this.blocker = null;
    }
  }

  // ------------------------------------------------------------------ internals

  private require(playbackId: string): Playback {
    const playback = this.playbacks.get(playbackId);
    if (!playback) throw new AppError('not_found', 'This playback was closed');
    return playback;
  }

  private rank(row: AnimeRow, streams: Parameters<typeof rankStreams>[0]): Ranked[] {
    const { anime, settings } = this.deps;
    return rankStreams(streams, {
      manual: anime.playbackPrefs(row),
      qualityPreference: settings.getAppSettings().playerQuality,
      lastServer: settings.getValue<string | null>(lastServerKey(row.sourceId), null),
    });
  }

  private async handleEvent(playback: Playback, event: PlaybackEvent): Promise<PlaybackUpdate> {
    if (event.type === 'playing') {
      const server = playback.candidates[playback.active]?.stream.server;
      if (server) this.deps.settings.setValue(lastServerKey(playback.anime.sourceId), server);
      return { type: 'ok' };
    }

    const failedStream = playback.candidates[playback.active];
    const failure = (): PlaybackUpdate => ({
      type: 'failed',
      tried: [...new Set(playback.tried)],
      message: event.message,
      httpStatus: event.httpStatus,
    });

    // 403 or 410 in the middle of playback: the link probably expired. Ask the extension for a new one
    // once, before giving up on the server (STR-4).
    if (!playback.refreshed && failedStream && (event.httpStatus === 403 || event.httpStatus === 410)) {
      playback.refreshed = true;
      try {
        const fresh = await this.deps.extensions.streamsFor(playback.anime, playback.episode, true);
        const ranked = this.rank(playback.anime, fresh);
        const same = ranked.findIndex(
          (r) => r.stream.server === failedStream.stream.server && r.stream.quality === failedStream.stream.quality,
        );
        playback.candidates = ranked;
        playback.failed.clear();
        if (same >= 0) {
          await this.openFirstWorking(playback, [same]);
          return { type: 'switched', reason: 'refreshed', session: this.describe(playback) };
        }
      } catch {
        // The extension could not refresh it either: fall through to the next stream.
        if (!playback.candidates[playback.active]) return failure();
      }
    }

    playback.attempts++;
    playback.tried.push(failedStream ? label(failedStream) : 'unknown');
    playback.failed.add(playback.active);
    if (playback.attempts >= MAX_ATTEMPTS) return failure();

    const remaining = playback.candidates
      .map((_c, position) => position)
      .filter((position) => !playback.failed.has(position));
    try {
      await this.openFirstWorking(playback, remaining);
    } catch {
      return failure();
    }
    return { type: 'switched', reason: 'fallback', session: this.describe(playback) };
  }

  /** Probes candidates in order and activates the first that answers. */
  private async openFirstWorking(playback: Playback, order: number[]): Promise<void> {
    let last: ProbeResult | null = null;
    for (const position of order) {
      const candidate = playback.candidates[position];
      if (!candidate || playback.failed.has(position)) continue;
      const session = this.deps.sessions.create({
        entryUrl: candidate.stream.url,
        kind: guessKind(candidate.stream) === 'mp4' ? 'file' : 'hls',
        headers: candidate.stream.headers,
        extensionId: playback.extensionId,
      });
      const result = await probeStream(candidate.stream, this.deps.upstream, session);
      if (!result.ok) {
        this.deps.sessions.delete(session.id);
        playback.failed.add(position);
        playback.tried.push(label(candidate));
        last = result;
        continue;
      }
      // The probe may have found out what an unlabelled URL is.
      session.kind = result.kind === 'mp4' ? 'file' : 'hls';
      if (playback.sessionId) this.deps.sessions.delete(playback.sessionId);
      playback.sessionId = session.id;
      playback.active = position;
      playback.kind = result.kind;
      playback.url = `anime://play/${session.id}/${result.kind === 'hls' ? 'index.m3u8' : 'media.mp4'}`;
      return;
    }
    throw new AppError('extension', last ? `No server answered (${last.reason})` : 'This episode has no streams', {
      kind: 'no_stream',
      ...(last && !last.ok && last.httpStatus !== null && { status: last.httpStatus }),
    });
  }

  private describe(playback: Playback): PlaybackSessionDto {
    const { anime, episodes, settings, store } = this.deps;
    const lastServer = settings.getValue<string | null>(lastServerKey(playback.anime.sourceId), null);
    const options: StreamOption[] = playback.candidates.map((candidate, index) => ({
      index,
      server: candidate.stream.server,
      quality: candidate.stream.quality ?? null,
      kind: guessKind(candidate.stream) === 'mp4' ? 'mp4' : 'hls',
      status: index === playback.active ? 'playing' : playback.failed.has(index) ? 'failed' : 'available',
      lastWorked: candidate.stream.server === lastServer,
    }));
    const list = episodes.list(playback.anime.id);
    const around = neighbors(list, playback.episode.id);
    const ref = (episode: EpisodeRecord | null): EpisodeRef | null =>
      episode
        ? { episodeId: episode.id, label: episode.number !== null ? String(episode.number) : episode.name }
        : null;
    return {
      playbackId: playback.id,
      episodeId: playback.episode.id,
      animeId: playback.anime.id,
      url: playback.url,
      kind: playback.kind,
      streams: options,
      activeIndex: playback.active,
      animeTitle: anime.get(playback.anime.id)?.title ?? playback.anime.title,
      episodeName: playback.episode.name,
      episodeNumber: playback.episode.number,
      sourceName: store.getSource(playback.anime.sourceId)?.name ?? null,
      next: ref(around.next),
      previous: ref(around.previous),
    };
  }
}
