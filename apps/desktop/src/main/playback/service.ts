import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppError,
  DOWNLOAD_FILE_MISSING,
  type EpisodeRef,
  type PlaybackEvent,
  type PlaybackSession as PlaybackSessionDto,
  type PlaybackUpdate,
  type CodecSupport,
  type StreamOption,
} from '@matane-anime/shared';
import { powerSaveBlocker } from 'electron';
import type { AnimeRepository, AnimeRow } from '../db/repositories/anime';
import type { DownloadsRepository, DownloadRecord } from '../db/repositories/downloads';
import type { EpisodeRecord, EpisodesRepository } from '../db/repositories/episodes';
import type { ExtensionStore } from '../db/repositories/extension-store';
import type { SettingsRepository } from '../db/repositories/settings';
import type { ExtensionService } from '../extensions/service';
import { abortable, type RequestRegistry } from '../ipc/requests';
import { isStreamUnsupported } from './codecs';
import { neighbors } from './neighbors';
import { type ProbeResult, probeStream } from './probe';
import type { UpstreamFetch } from './proxy';
import { type Ranked, demote, guessKind, rankStreams } from './ranking';
import type { PlaybackSession as ProbedSession, SessionStore } from './sessions';

/** Playback errors tolerated before the player shows the error state (docs/PRD.md STR-3). */
export const MAX_ATTEMPTS = 3;
/** Streams probed at the same time, and how long the better-ranked ones get before the next is started too. */
const PROBE_PARALLEL = 3;
/** How long after a stream opened the neighbours' streams are fetched, when the first frame has not triggered it. */
const LOOK_AROUND_DELAY_MS = 3000;
const PROBE_STAGGER_MS = 1500;
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
  /** Finished downloads are played from disk before any stream is tried (STR-7). */
  downloads: Pick<DownloadsRepository, 'byEpisode' | 'update'>;
  /** Whether a regular file exists. Defaults to `fs.stat`; a test replaces it. */
  fileExists?(path: string): Promise<boolean>;
  /** Head start of a better-ranked stream over the next one, in ms. Defaults to 1500; a test shortens it. */
  probeStaggerMs?: number;
  /** Where playback of an episode starts (PRG-4). */
  resumeFor(episode: EpisodeRecord): number;
  /** A line for the log: what was fetched ahead, and how long it took. */
  log?(message: string): void;
}

/** The only server of a playback from disk. */
export const LOCAL_SERVER = 'Downloaded';
/** The playlist inside an HLS download's folder. */
const LOCAL_PLAYLIST = 'playlist.m3u8';

const isFile = (path: string): Promise<boolean> =>
  stat(path).then(
    (stats) => stats.isFile(),
    () => false,
  );

interface Playback {
  id: string;
  episode: EpisodeRecord;
  anime: AnimeRow;
  extensionId: string;
  candidates: Ranked[];
  /** Candidate positions that failed to probe or to play. */
  failed: Set<number>;
  /** Candidate positions whose playlist only has variants the player cannot decode (PLY-12): tried last. */
  unsupported: Set<number>;
  active: number;
  kind: 'hls' | 'mp4';
  /** Played from a download: one synthetic candidate, no extension involved. */
  local: DownloadRecord | null;
  sessionId: string | null;
  url: string;
  attempts: number;
  /** `getStreams` was called again for an expired link; it is only worth doing once. */
  refreshed: boolean;
  /** Every server tried, in order, for the error state. */
  tried: string[];
  /** Serializes calls: a stream can raise several errors at once. */
  lock: Promise<unknown>;
  /** The streams of the episodes around this one were asked for already (once per playback). */
  prefetched: boolean;
  /** Looks around a few seconds after the stream opened, if no first frame has done it by then. */
  prefetchTimer?: ReturnType<typeof setTimeout>;
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
  /** What the renderer reported about codecs; null until it has (then no stream is judged). */
  private codecSupport: CodecSupport | null = null;
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
    // STR-7: a downloaded episode plays from disk before anything else, so no extension and no network is needed.
    const download = await this.usableDownload(episode.id);
    if (download) return this.startLocal(episode, row, download);
    extensions.assertAvailable(row.sourceId);

    // Streams kept from an earlier look (or fetched ahead of time) may have died since.
    const kept = extensions.hasCachedStreams(row, episode);
    const streams = await extensions.streamsFor(row, episode, false);
    const playback: Playback = {
      id: randomBytes(9).toString('base64url'),
      episode,
      anime: row,
      extensionId: row.sourceId.split('/')[0] as string,
      candidates: this.rank(row, streams),
      failed: new Set(),
      unsupported: new Set(),
      active: -1,
      kind: 'hls',
      local: null,
      sessionId: null,
      url: '',
      attempts: 0,
      refreshed: false,
      tried: [],
      lock: Promise.resolve(),
      prefetched: false,
    };
    try {
      await this.openFirstWorking(
        playback,
        playback.candidates.map((_c, position) => position),
      );
    } catch (error) {
      if (!kept) throw error;
      // Nothing answered, and the links were not new: ask the extension for fresh ones, once.
      playback.candidates = this.rank(row, await extensions.streamsFor(row, episode, true));
      playback.failed.clear();
      playback.unsupported.clear();
      await this.openFirstWorking(
        playback,
        playback.candidates.map((_c, position) => position),
      );
    }
    this.playbacks.set(playback.id, playback);
    // The first frame normally starts this; a player that never paints one (paused, hidden) should not skip it.
    playback.prefetchTimer = setTimeout(() => {
      try {
        this.prefetchAround(playback);
      } catch {
        // A nicety: whatever goes wrong here is not the player's problem.
      }
    }, LOOK_AROUND_DELAY_MS);
    playback.prefetchTimer.unref();
    return this.describe(playback);
  }

  /**
   * Once the first frame is up (or a few seconds after the stream opened), asks the extension for the streams of
   * the episodes on both sides of this one: the
   * next first (autoplay and Next), then the previous, so that going either way does not wait for them. They are
   * kept for 24 hours by `ExtensionService`. Never an error: it is a nicety, a download of that episode needs no
   * stream, and what is already known is not asked again.
   */
  private prefetchAround(playback: Playback): void {
    if (playback.prefetched) return;
    playback.prefetched = true;
    const { anime, episodes, extensions, downloads, log } = this.deps;
    const around = neighbors(episodes.list(playback.anime.id), playback.episode.id);
    const targets = [
      { side: 'next', episode: around.next },
      { side: 'previous', episode: around.previous },
    ] as const;
    void (async () => {
      for (const { side, episode } of targets) {
        // One after the other, so the likelier choice is not slowed by the other; and not once the player has gone.
        if (!episode || !this.playbacks.has(playback.id)) continue;
        if (episode.sourceMissing || downloads.byEpisode(episode.id)?.status === 'done') continue;
        const title = `${anime.get(playback.anime.id)?.title ?? playback.anime.title}, ${episode.name}`;
        try {
          extensions.assertAvailable(playback.anime.sourceId);
          if (extensions.hasCachedStreams(playback.anime, episode)) {
            log?.(`prefetch ${side}: ${title}: already known`);
            continue;
          }
          const started = Date.now();
          const streams = await extensions.streamsFor(playback.anime, episode, false);
          log?.(`prefetch ${side}: ${title}: ${streams.length} stream(s) in ${Date.now() - started} ms`);
        } catch (error) {
          log?.(`prefetch ${side}: ${title}: failed (${error instanceof Error ? error.message : String(error)})`);
        }
      }
    })();
  }

  /**
   * The finished download of an episode whose files are still there. When they are gone the download becomes
   * an error the Downloads page can retry (`file_missing`), and the caller streams instead.
   */
  private async usableDownload(episodeId: number): Promise<DownloadRecord | null> {
    const download = this.deps.downloads.byEpisode(episodeId);
    if (download?.status !== 'done' || !download.path) return null;
    if (await this.fileExists(localEntry(download))) return download;
    this.deps.downloads.update(download.id, { status: 'error', error: DOWNLOAD_FILE_MISSING });
    return null;
  }

  private fileExists(path: string): Promise<boolean> {
    return (this.deps.fileExists ?? isFile)(path);
  }

  private startLocal(episode: EpisodeRecord, row: AnimeRow, download: DownloadRecord): PlaybackSessionDto {
    const playback: Playback = {
      id: randomBytes(9).toString('base64url'),
      episode,
      anime: row,
      extensionId: row.sourceId.split('/')[0] as string,
      candidates: [
        {
          stream: {
            url: localEntry(download),
            server: LOCAL_SERVER,
            kind: download.kind,
            ...(download.quality !== null && { quality: download.quality }),
          },
          originalIndex: 0,
        },
      ],
      failed: new Set(),
      unsupported: new Set(),
      active: 0,
      kind: download.kind,
      local: download,
      sessionId: null,
      url: '',
      attempts: 0,
      refreshed: false,
      tried: [],
      lock: Promise.resolve(),
      prefetched: false,
    };
    const session = this.deps.sessions.createLocal({
      path: download.path as string,
      media: download.kind,
    });
    playback.sessionId = session.id;
    playback.url = `anime://play/${session.id}/${download.kind === 'hls' ? LOCAL_PLAYLIST : 'media.mp4'}`;
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
        // The only candidate of a download is the one already open: nothing to switch, nothing to remember.
        if (playback.local) return this.describe(playback);
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
    clearTimeout(playback.prefetchTimer);
    if (playback.sessionId) this.deps.sessions.delete(playback.sessionId);
    this.playbacks.delete(playbackId);
  }

  closeAll(): void {
    for (const id of [...this.playbacks.keys()]) this.close(id);
    this.keepAwake(false);
  }

  /** The renderer measured which codecs Chromium plays (PLY-12). Applies to the next probe on. */
  setCodecSupport(support: CodecSupport): void {
    this.codecSupport = support;
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
    if (playback.local) return this.handleLocalEvent(playback, event);
    if (event.type === 'playing') {
      const server = playback.candidates[playback.active]?.stream.server;
      if (server) this.deps.settings.setValue(lastServerKey(playback.anime.sourceId), server);
      // A download plays without the extension (STR-7), so only a streamed episode looks around.
      this.prefetchAround(playback);
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
        playback.unsupported.clear();
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

  /**
   * A download has no other server to move to. If its files vanished meanwhile the download is marked so the
   * Downloads page offers Retry; either way the player gets a clear failure instead of a retry loop.
   */
  private async handleLocalEvent(playback: Playback, event: PlaybackEvent): Promise<PlaybackUpdate> {
    const download = playback.local as DownloadRecord;
    if (event.type === 'playing') return { type: 'ok' };
    const missing = !(await this.fileExists(localEntry(download)));
    if (missing) this.deps.downloads.update(download.id, { status: 'error', error: DOWNLOAD_FILE_MISSING });
    playback.failed.add(playback.active);
    return {
      type: 'failed',
      tried: [LOCAL_SERVER],
      message: missing ? 'The downloaded files are missing' : event.message,
      httpStatus: event.httpStatus,
    };
  }

  /**
   * Probes candidates and activates the first that answers. The best-ranked one starts alone; if it has not
   * answered after a short head start, or fails, the next starts beside it (up to `PROBE_PARALLEL` at once), so a
   * dead server at the top costs about a second and a half instead of its whole timeout. The first success wins
   * and the others are cancelled; only streams that really failed are marked failed.
   */
  private async openFirstWorking(playback: Playback, order: number[]): Promise<void> {
    const queue = demote(
      order.filter((position) => playback.candidates[position] && !playback.failed.has(position)),
      (position) => playback.unsupported.has(position),
    );
    const stagger = this.deps.probeStaggerMs ?? PROBE_STAGGER_MS;
    const stop = new AbortController();
    type Attempt = { position: number; result: ProbeResult };
    const running = new Map<number, Promise<Attempt>>();
    const sessions = new Map<number, ProbedSession>();
    const TICK = Symbol('tick');
    let next = 0;
    let last: ProbeResult | null = null;
    type Opened = { position: number; kind: 'hls' | 'mp4' };
    let winner: Opened | null = null;
    // Streams that answered but have nothing the player can decode (PLY-12): used only when no other one answers.
    const unplayable: Opened[] = [];

    const begin = (): void => {
      const position = queue[next++] as number;
      const candidate = playback.candidates[position] as Ranked;
      const session = this.deps.sessions.create({
        entryUrl: candidate.stream.url,
        kind: guessKind(candidate.stream) === 'mp4' ? 'file' : 'hls',
        headers: candidate.stream.headers,
        extensionId: playback.extensionId,
      });
      sessions.set(position, session);
      running.set(
        position,
        probeStream(candidate.stream, this.deps.upstream, session, undefined, stop.signal).then((result) => ({
          position,
          result,
        })),
      );
    };

    try {
      if (next < queue.length) begin();
      while (running.size > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const tick =
          next < queue.length && running.size < PROBE_PARALLEL
            ? new Promise<typeof TICK>((resolve) => {
                timer = setTimeout(() => resolve(TICK), stagger);
              })
            : null;
        const settled = await Promise.race(tick ? [...running.values(), tick] : [...running.values()]);
        clearTimeout(timer);
        if (settled === TICK) {
          begin();
          continue;
        }
        running.delete(settled.position);
        if (settled.result.ok) {
          const pick = { position: settled.position, kind: settled.result.kind };
          if (!isStreamUnsupported(settled.result.variants, this.codecSupport)) {
            winner = pick;
            break;
          }
          playback.unsupported.add(pick.position);
          unplayable.push(pick);
          if (next < queue.length && running.size < PROBE_PARALLEL) begin();
          continue;
        }
        const failed = playback.candidates[settled.position] as Ranked;
        this.deps.sessions.delete((sessions.get(settled.position) as ProbedSession).id);
        sessions.delete(settled.position);
        playback.failed.add(settled.position);
        playback.tried.push(label(failed));
        last = settled.result;
        if (next < queue.length && running.size < PROBE_PARALLEL) begin();
      }
      // Several can answer; the best-ranked one of them goes first.
      winner ??= unplayable.sort((x, y) => queue.indexOf(x.position) - queue.indexOf(y.position))[0] ?? null;
    } finally {
      // Whoever lost, or was still waiting when the winner came in, is no longer wanted.
      stop.abort();
      for (const [position, session] of sessions) {
        if (position !== winner?.position) this.deps.sessions.delete(session.id);
      }
    }

    if (!winner) {
      throw new AppError('extension', last ? `No server answered (${last.reason})` : 'This episode has no streams', {
        kind: 'no_stream',
        ...(last && !last.ok && last.httpStatus !== null && { status: last.httpStatus }),
      });
    }
    const session = sessions.get(winner.position) as ProbedSession;
    // The probe may have found out what an unlabelled URL is.
    session.kind = winner.kind === 'mp4' ? 'file' : 'hls';
    if (playback.sessionId) this.deps.sessions.delete(playback.sessionId);
    playback.sessionId = session.id;
    playback.active = winner.position;
    playback.kind = winner.kind;
    playback.url = `anime://play/${session.id}/${winner.kind === 'hls' ? 'index.m3u8' : 'media.mp4'}`;
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
      resumeMs: this.deps.resumeFor(playback.episode),
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

/** The file the player starts from: the folder's playlist (HLS) or the `.mp4`. */
const localEntry = (download: DownloadRecord): string =>
  download.kind === 'hls' ? join(download.path as string, LOCAL_PLAYLIST) : (download.path as string);
