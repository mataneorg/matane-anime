import { existsSync } from 'node:fs';
import { cp, mkdir, rename, rm, access, constants } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { Stream } from '@matane-anime/extension-sdk';
import {
  AppError,
  type AppSettings,
  DOWNLOAD_FILE_MISSING,
  type DownloadItem,
  type DownloadQuality,
  type DownloadProgress,
  type DownloadStorage,
  type EnqueueInput,
  type EnqueueResult,
  type SettingsPatch,
} from '@matane-anime/shared';
import type { AnimeRow } from '../db/repositories/anime';
import type { DownloadRecord, DownloadsRepository } from '../db/repositories/downloads';
import type { EpisodeRecord } from '../db/repositories/episodes';
import { pathExists, pruneEmptyParents, removePath, treeSize } from './atomic';
import { exceedsLimit, freeBytes as diskFreeBytes, gbToBytes, hasEnoughSpace } from './disk';
import { DownloadAborted, DownloadFetchError, type DownloadUpstream, type FetchSettings } from './fetch';
import { LOCAL_PLAYLIST } from './hls';
import { episodePath, tempPath, uniquePath } from './layout';
import { type Plan, PlanError, buildPlan } from './plan';
import { SpeedMeter } from './progress';
import { type TransferProgress, downloadHls, downloadMp4 } from './transfer';

export type EnqueueReason = 'manual' | 'auto' | 'ahead';

/** Codes kept in `downloads.error`. The UI maps them to text; anything else is shown as it is. */
export const DOWNLOAD_ERRORS = {
  live: 'live',
  noStream: 'no_stream',
  noExtension: 'no_extension',
  unsupportedEncryption: 'unsupported_encryption',
  sizeLimit: 'size_limit',
  diskSpace: 'disk_space',
  diskFull: 'disk_full',
  writeFailed: 'write_failed',
  expired: 'expired',
  network: 'network',
  unreachable: 'unreachable',
  fileMissing: DOWNLOAD_FILE_MISSING,
} as const;

/** Progress events go out at most this often per download (about 4 a second). */
export const PROGRESS_INTERVAL_MS = 250;
/** Progress is saved to the database this often while a download runs; events are what the UI follows. */
const SAVE_INTERVAL_MS = 1000;
/** Up to this many episodes are checked against the site (live? size?) while `enqueue` waits. */
const INLINE_PREFLIGHT = 3;
const PREVIEW_FETCH = { retries: 0, timeoutMs: 10_000 } as const;

export interface DownloadServiceDeps {
  downloads: DownloadsRepository;
  episodes: { get(id: number): EpisodeRecord | undefined };
  anime: { get(id: number): AnimeRow | undefined };
  settings: {
    getAppSettings(): AppSettings;
    updateAppSettings(patch: SettingsPatch): AppSettings;
  };
  /** Display name of a source, "Example (EN)", for the folder name. */
  sourceName(sourceId: string): string | null;
  /** Throws when the extension of this source is not loaded. */
  assertAvailable(sourceId: string): void;
  /**
   * The streams of an episode in the order they should be tried (the player's ranking, with the quality that
   * downloads want), and the extension that owns them. `fresh` asks the extension again (R5).
   */
  streamsFor(
    episodeId: number,
    fresh: boolean,
    quality: DownloadQuality,
  ): Promise<{ streams: Stream[]; extensionId: string }>;
  upstream: DownloadUpstream;
  /** Where downloads go while the `downloadFolder` setting is empty. */
  defaultFolder(): string;
  isOnline(): boolean;
  /** Calls the listener when the machine goes on or offline; returns the unsubscribe. */
  onOnlineChange(listener: (online: boolean) => void): () => void;
  emitProgress(items: DownloadProgress[]): void;
  /** Resolves when the extensions are loaded; nothing is started before. */
  ready?: Promise<unknown>;
  now?: () => number;
  freeBytes?: (path: string) => Promise<number | null>;
  /** Timeouts and backoff, replaced in tests. */
  fetchOptions?: Partial<Pick<FetchSettings, 'timeoutMs' | 'retries' | 'backoffMs' | 'sleep'>>;
  log?: (message: string, error?: unknown) => void;
}

type StopReason = 'pause' | 'cancel' | 'remove' | 'shutdown' | 'offline';

class Job {
  readonly controller = new AbortController();
  stop: StopReason | null = null;
  /** Fresh `getStreams` calls made for this download (R5 allows one). */
  refreshes = 0;
  segmentsDone = 0;
  segmentsTotal: number | null = null;
  bytesDone = 0;
  sizeBytes: number | null = null;
  network = 0;
  readonly meter = new SpeedMeter();
  lastEmit = Number.NEGATIVE_INFINITY;
  lastSave = 0;
  promise: Promise<void> = Promise.resolve();
}

type Outcome = { type: 'done' } | { type: 'stopped' } | { type: 'failed'; code: string };

/**
 * Owns the download queue and the files (docs/PRD.md DL-1…10). The queue lives in the `downloads` table, so
 * it survives a restart; what runs is `parallel episodes × parallel segments` at most, and only while the
 * machine is online. All network goes through the injected upstream and all knowledge of streams through
 * `streamsFor`, so none of it needs Electron.
 */
export class DownloadService {
  private readonly jobs = new Map<number, Job>();
  /** Downloads whose size limit the user confirmed (a forced enqueue, or Retry). Lost on restart. */
  private readonly forced = new Set<number>();
  private started = false;
  private booting: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private scheduled = false;
  private unsubscribe: (() => void) | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: DownloadServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  // ------------------------------------------------------------------ lifecycle

  /** Puts what was running when the app closed back in the queue and starts working. */
  start(): void {
    if (this.unsubscribe || this.disposed) return;
    this.deps.downloads.recoverInterrupted();
    this.unsubscribe = this.deps.onOnlineChange((online) => {
      if (online) this.schedule();
      else for (const job of this.jobs.values()) this.stopJob(job, 'offline');
    });
    this.booting = Promise.resolve(this.deps.ready)
      .catch(() => undefined)
      .then(() => {
        this.started = true;
        this.schedule();
      });
  }

  /**
   * Stops everything for good (the app is quitting). Synchronous: the database closes right after. What was
   * downloading goes back to queued; finished files stay and half-written ones are dropped on the next run.
   */
  shutdown(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    for (const job of this.jobs.values()) this.stopJob(job, 'shutdown');
    this.deps.downloads.recoverInterrupted();
  }

  /** Resolves when nothing is running and nothing more can start (offline counts). For tests and quitting. */
  async idle(): Promise<void> {
    await this.booting;
    for (;;) {
      const running = [...this.jobs.values()].map((job) => job.promise);
      if (running.length > 0) {
        await Promise.all(running);
        continue;
      }
      if (!this.canStartMore()) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  // ------------------------------------------------------------------ queries

  list(): DownloadItem[] {
    return this.deps.downloads.list();
  }

  async storage(): Promise<DownloadStorage> {
    const settings = this.deps.settings.getAppSettings();
    const folder = this.folder(settings);
    return {
      folder,
      usedBytes: this.deps.downloads.usedBytes(),
      limitBytes: gbToBytes(settings.downloadSizeLimitGb),
      freeBytes: await this.free(folder),
      counts: this.deps.downloads.counts(),
    };
  }

  // ------------------------------------------------------------------ enqueue

  /**
   * Adds episodes to the queue. `reason` tells a click from the automatic callers (update checks, download
   * ahead), which never pass the size limit; a manual one may, with `force` once the user confirmed (DL-10).
   * The first few episodes are looked at on the site right away, so "live" or "too big" is said at once; for
   * bigger batches that happens when each one starts and shows as an error on its row.
   */
  async enqueue(
    input: EnqueueInput,
    options: { reason: EnqueueReason } = { reason: 'manual' },
  ): Promise<EnqueueResult> {
    const result: EnqueueResult = { queued: [], existing: [], refused: [] };
    const settings = this.deps.settings.getAppSettings();
    const limit = gbToBytes(settings.downloadSizeLimitGb);
    const force = options.reason === 'manual' && input.force === true;
    const free = await this.free(this.folder(settings));
    const episodeIds = [...new Set(input.episodeIds)];
    const inline = episodeIds.length <= INLINE_PREFLIGHT;
    const refuse = (episodeId: number, reason: EnqueueResult['refused'][number]['reason']): void => {
      result.refused.push({ episodeId, reason });
    };

    for (const episodeId of episodeIds) {
      const episode = this.deps.episodes.get(episodeId);
      const anime = episode && this.deps.anime.get(episode.animeId);
      if (!episode || !anime) {
        refuse(episodeId, 'no_stream');
        continue;
      }
      try {
        this.deps.assertAvailable(anime.sourceId);
      } catch {
        refuse(episodeId, 'no_extension');
        continue;
      }

      const existing = this.deps.downloads.byEpisode(episodeId);
      if (existing && existing.status !== 'error') {
        result.existing.push(episodeId);
        continue;
      }
      if (!force && this.deps.downloads.committedBytes() >= limit) {
        refuse(episodeId, 'size_limit');
        continue;
      }

      let estimate: number | null = null;
      let kind: DownloadRecord['kind'] = existing?.kind ?? 'hls';
      if (inline) {
        const preview = await this.preview(episodeId, settings);
        if (preview.refusal) {
          refuse(episodeId, preview.refusal);
          continue;
        }
        if (preview.plan) {
          estimate = preview.plan.estimateBytes;
          kind = preview.plan.kind;
        }
        if (!force && exceedsLimit(this.deps.downloads.committedBytes(), estimate, limit)) {
          refuse(episodeId, 'size_limit');
          continue;
        }
      }
      if (!hasEnoughSpace(estimate, free)) {
        refuse(episodeId, 'disk_space');
        continue;
      }

      if (existing) this.requeue(existing, force);
      else {
        const id = this.deps.downloads.insert({ episodeId, kind, sizeBytes: estimate, now: this.now() });
        if (force) this.forced.add(id);
      }
      result.queued.push(episodeId);
    }
    this.schedule();
    return result;
  }

  /** Looks at the site without writing anything: is this downloadable, and how big is it? */
  private async preview(
    episodeId: number,
    settings: AppSettings,
  ): Promise<{ plan?: Plan; refusal?: EnqueueResult['refused'][number]['reason'] }> {
    const controller = new AbortController();
    try {
      return { plan: await this.resolve(episodeId, controller.signal, settings, null) };
    } catch (error) {
      const code = this.failureCode(error);
      if (code === DOWNLOAD_ERRORS.live) return { refusal: 'live' };
      if (code === DOWNLOAD_ERRORS.noStream || code === DOWNLOAD_ERRORS.unsupportedEncryption) {
        return { refusal: 'no_stream' };
      }
      if (code === DOWNLOAD_ERRORS.noExtension) return { refusal: 'no_extension' };
      // The site did not answer right now (or we are offline): queue it, the run will tell.
      return {};
    }
  }

  // ------------------------------------------------------------------ controls

  pause(id: number): void {
    const row = this.deps.downloads.get(id);
    if (!row || (row.status !== 'queued' && row.status !== 'downloading')) return;
    this.deps.downloads.update(id, { status: 'paused' });
    const job = this.jobs.get(id);
    if (job) this.stopJob(job, 'pause');
  }

  resume(id: number): void {
    const row = this.deps.downloads.get(id);
    if (!row || row.status !== 'paused') return;
    this.deps.downloads.update(id, { status: 'queued' });
    this.schedule();
  }

  pauseAll(): void {
    for (const row of this.deps.downloads.all()) {
      if (row.status === 'queued' || row.status === 'downloading') this.pause(row.id);
    }
  }

  resumeAll(): void {
    for (const row of this.deps.downloads.all()) if (row.status === 'paused') this.resume(row.id);
  }

  /** Retry after an error. Takes the size limit as confirmed, and picks up whatever is on disk (DL-5, DL-7). */
  retry(id: number): void {
    const row = this.deps.downloads.get(id);
    if (!row || row.status !== 'error') return;
    this.requeue(row, true);
    this.schedule();
  }

  reorder(ids: number[]): void {
    this.deps.downloads.reorder(ids);
  }

  /** Stops an unfinished download and deletes what it saved. */
  async cancel(id: number): Promise<void> {
    const row = this.deps.downloads.get(id);
    if (!row || row.status === 'done') return;
    await this.discard(row, 'cancel');
  }

  /** Deletes a download with its files, finished or not. */
  async remove(id: number): Promise<void> {
    const row = this.deps.downloads.get(id);
    if (row) await this.discard(row, 'remove');
  }

  async clearFailed(): Promise<void> {
    for (const row of this.deps.downloads.all()) if (row.status === 'error') await this.discard(row, 'remove');
  }

  /**
   * New downloads go to `folder`. With `move`, the finished ones follow it and their stored paths are
   * rewritten together; if anything fails the files go back and nothing changes (DL-6).
   */
  async changeFolder(folder: string, move: boolean): Promise<void> {
    if (!isAbsolute(folder)) throw new AppError('invalid_input', 'The download folder must be an absolute path');
    const settings = this.deps.settings.getAppSettings();
    const from = this.folder(settings);
    const to = resolve(folder);
    if (to === resolve(from)) return;
    try {
      await mkdir(to, { recursive: true });
      await access(to, constants.W_OK);
    } catch (error) {
      throw new AppError('invalid_input', `Cannot write to ${to}: ${(error as Error).message}`);
    }

    if (move) {
      const rows = this.deps.downloads
        .all()
        .filter((row) => row.status === 'done' && row.path && isInside(from, row.path));
      const moved: { id: number; from: string; to: string }[] = [];
      try {
        for (const row of rows) {
          const source = row.path as string;
          const target = join(to, relative(from, source));
          await moveTree(source, target);
          moved.push({ id: row.id, from: source, to: target });
        }
        this.deps.downloads.rewritePaths(moved.map(({ id, to: path }) => ({ id, path })));
      } catch (error) {
        for (const entry of moved.reverse()) await moveTree(entry.to, entry.from).catch(() => undefined);
        throw new AppError('internal', `Could not move the downloads: ${(error as Error).message}`);
      }
      for (const entry of moved) await pruneEmptyParents(dirname(entry.from), resolve(from));
    }
    this.deps.settings.updateAppSettings({ downloadFolder: to });
  }

  // ------------------------------------------------------------------ scheduling

  private canStartMore(): boolean {
    if (!this.started || this.disposed || !this.deps.isOnline()) return false;
    const { downloadParallelEpisodes } = this.deps.settings.getAppSettings();
    return this.jobs.size < downloadParallelEpisodes && this.deps.downloads.nextQueued() !== undefined;
  }

  /** Starts what can start, on the next tick, so a burst of changes is handled once. */
  private schedule(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    while (this.canStartMore()) {
      const row = this.deps.downloads.nextQueued();
      if (!row) return;
      this.begin(row);
    }
  }

  private begin(row: DownloadRecord): void {
    const job = new Job();
    this.jobs.set(row.id, job);
    this.deps.downloads.update(row.id, { status: 'downloading', error: null });
    job.promise = this.run(row.id, job)
      .catch((error: unknown): Outcome =>
        error instanceof DownloadAborted ? { type: 'stopped' } : { type: 'failed', code: this.failureCode(error) },
      )
      .then((outcome) => this.settle(row.id, job, outcome));
  }

  private stopJob(job: Job, reason: StopReason): void {
    job.stop ??= reason;
    job.controller.abort();
  }

  private requeue(row: DownloadRecord, confirmed: boolean): void {
    // A finished download whose files vanished has nothing to continue from.
    const fresh = row.error === DOWNLOAD_FILE_MISSING;
    this.deps.downloads.update(row.id, {
      status: 'queued',
      error: null,
      ...(fresh && { path: null, bytesDone: 0, segmentsDone: 0, completedAt: null }),
    });
    if (confirmed) this.forced.add(row.id);
  }

  // ------------------------------------------------------------------ running one download

  private async run(id: number, job: Job): Promise<Outcome> {
    const settings = this.deps.settings.getAppSettings();
    const row = this.deps.downloads.get(id);
    if (!row) return { type: 'stopped' };

    let plan = await this.resolve(row.episodeId, job.controller.signal, settings, job);
    this.assertRunning(job);
    await this.checkRoom(row, plan, settings);
    for (;;) {
      this.prepare(id, plan, job, settings);
      try {
        await this.transfer(id, plan, job, settings);
        break;
      } catch (error) {
        // The link died in the middle: ask the extension once for a new one and carry on with what is there.
        if (!(error instanceof DownloadFetchError && error.expired) || job.refreshes >= 1) throw error;
        plan = await this.resolve(row.episodeId, job.controller.signal, settings, job, true);
        this.assertRunning(job);
      }
    }

    const path = this.deps.downloads.get(id)?.path as string;
    const bytes = await treeSize(path);
    const segments = plan.kind === 'hls' ? plan.segmentCount : null;
    this.deps.downloads.update(id, {
      status: 'done',
      error: null,
      bytesDone: bytes,
      sizeBytes: bytes,
      segmentsDone: segments ?? 0,
      segmentsTotal: segments,
      completedAt: this.now(),
    });
    job.bytesDone = bytes;
    job.sizeBytes = bytes;
    return { type: 'done' };
  }

  private assertRunning(job: Job): void {
    if (job.controller.signal.aborted) throw new DownloadAborted();
  }

  /**
   * The plan for an episode: the extension's streams, ranked, and the first that can be downloaded. A 403 or
   * 410 on the playlists means an expired link: ask the extension again, once per download (R5).
   */
  private async resolve(
    episodeId: number,
    signal: AbortSignal,
    settings: AppSettings,
    job: Job | null,
    fresh = false,
  ): Promise<Plan> {
    const preference = settings.downloadQuality === 'playback' ? settings.playerQuality : settings.downloadQuality;
    for (;;) {
      if (fresh && job) {
        if (job.refreshes >= 1) throw new DownloadFetchError('http', 'HTTP 403', 403, false);
        job.refreshes++;
      }
      const { streams, extensionId } = await this.deps.streamsFor(episodeId, fresh, settings.downloadQuality);
      if (signal.aborted) throw new DownloadAborted();
      try {
        return await buildPlan(streams, {
          preference,
          extensionId,
          fetch: {
            upstream: this.deps.upstream,
            source: { extensionId },
            signal,
            ...this.deps.fetchOptions,
            ...(job === null && PREVIEW_FETCH),
          },
        });
      } catch (error) {
        if (error instanceof PlanError && error.expired && !fresh) {
          fresh = true;
          continue;
        }
        throw error;
      }
    }
  }

  /** DL-9 and DL-10 once the size is known. */
  private async checkRoom(row: DownloadRecord, plan: Plan, settings: AppSettings): Promise<void> {
    const own = Math.max(row.bytesDone, row.sizeBytes ?? 0);
    const others = this.deps.downloads.committedBytes() - own;
    if (!this.forced.has(row.id) && exceedsLimit(others, plan.estimateBytes, gbToBytes(settings.downloadSizeLimitGb))) {
      throw new RoomError(DOWNLOAD_ERRORS.sizeLimit);
    }
    const remaining = plan.estimateBytes === null ? null : Math.max(0, plan.estimateBytes - row.bytesDone);
    if (!hasEnoughSpace(remaining, await this.free(this.folder(settings))))
      throw new RoomError(DOWNLOAD_ERRORS.diskSpace);
  }

  /** Records what the plan turned out to be, and fixes the path of the files on the first run. */
  private prepare(id: number, plan: Plan, job: Job, settings: AppSettings): void {
    const row = this.deps.downloads.get(id) as DownloadRecord;
    let path = row.path;
    if (path && row.kind !== plan.kind) {
      // It turned out to be the other kind: what was saved is of no use.
      void removePath(tempPath(path, row.kind));
      path = null;
    }
    if (!path) path = this.allocatePath(row, plan, settings);
    job.segmentsTotal = plan.kind === 'hls' ? plan.segmentCount : null;
    job.sizeBytes = plan.estimateBytes;
    this.deps.downloads.update(id, {
      kind: plan.kind,
      quality: plan.quality,
      server: plan.stream.server,
      sizeBytes: plan.estimateBytes,
      segmentsTotal: job.segmentsTotal,
      path,
    });
  }

  private allocatePath(row: DownloadRecord, plan: Plan, settings: AppSettings): string {
    const episode = this.deps.episodes.get(row.episodeId) as EpisodeRecord;
    const anime = this.deps.anime.get(episode.animeId) as AnimeRow;
    const base = episodePath({
      root: this.folder(settings),
      source: this.deps.sourceName(anime.sourceId) ?? anime.sourceId,
      anime: anime.title,
      episode: { number: episode.number, name: episode.name, variant: episode.variant },
      kind: plan.kind,
    });
    const others = this.deps.downloads.all().filter((other) => other.id !== row.id);
    const taken = (candidate: string): boolean =>
      existsSync(candidate) ||
      existsSync(tempPath(candidate, plan.kind)) ||
      others.some((other) => other.path === candidate);
    return uniquePath(base, taken);
  }

  private async transfer(id: number, plan: Plan, job: Job, settings: AppSettings): Promise<void> {
    const final = this.deps.downloads.get(id)?.path as string;
    job.bytesDone = 0;
    job.segmentsDone = 0;
    const progress: TransferProgress = {
      onBytes: (delta) => {
        job.bytesDone += delta;
        this.report(id, job);
      },
      onSegment: () => {
        job.segmentsDone++;
        this.report(id, job);
      },
      onNetwork: (delta) => {
        job.network += delta;
        job.meter.sample(this.now(), job.network);
      },
    };
    const fetch: FetchSettings = {
      upstream: this.deps.upstream,
      source: { extensionId: plan.extensionId },
      headers: plan.stream.headers ?? {},
      signal: job.controller.signal,
      ...this.deps.fetchOptions,
    };
    if (plan.kind === 'hls') {
      await downloadHls({
        plan,
        tmp: tempPath(final, 'hls'),
        final,
        fetch,
        parallel: settings.downloadParallelSegments,
        progress,
      });
    } else {
      await downloadMp4({ plan, final, fetch, progress });
    }
  }

  // ------------------------------------------------------------------ progress

  private snapshot(id: number, job: Job, status: DownloadProgress['status']): DownloadProgress {
    const now = this.now();
    const hls = job.segmentsTotal !== null;
    // Early on the playlist's estimate is all there is; later what was fetched so far is a better guide.
    const projected =
      hls && job.segmentsTotal && job.segmentsDone >= 2
        ? Math.max(job.bytesDone, Math.round((job.bytesDone / job.segmentsDone) * job.segmentsTotal))
        : job.sizeBytes;
    return {
      id,
      episodeId: this.deps.downloads.get(id)?.episodeId ?? 0,
      status,
      segmentsDone: job.segmentsDone,
      segmentsTotal: job.segmentsTotal,
      bytesDone: job.bytesDone,
      sizeBytes: projected,
      bytesPerSecond: Math.round(job.meter.bytesPerSecond(now)),
      etaSeconds: job.meter.etaSeconds(now, projected === null ? null : Math.max(0, projected - job.bytesDone)),
    };
  }

  /** Called on every chunk and segment; sends an event and saves to the database only as often as set above. */
  private report(id: number, job: Job): void {
    const now = this.now();
    if (now - job.lastEmit >= PROGRESS_INTERVAL_MS) {
      job.lastEmit = now;
      this.deps.emitProgress([this.snapshot(id, job, 'downloading')]);
    }
    if (now - job.lastSave >= SAVE_INTERVAL_MS) {
      job.lastSave = now;
      this.save(id, job);
    }
  }

  private save(id: number, job: Job): void {
    this.deps.downloads.update(
      id,
      { segmentsDone: job.segmentsDone, bytesDone: Math.max(0, job.bytesDone), segmentsTotal: job.segmentsTotal },
      { silent: true },
    );
  }

  /** The end of a run, whatever way it ended: record it and give the slot to the next download. */
  private settle(id: number, job: Job, outcome: Outcome): void {
    this.jobs.delete(id);
    if (this.disposed) return;
    const row = this.deps.downloads.get(id);
    // Cancel and remove delete the row themselves once the run is over.
    if (job.stop !== 'cancel' && job.stop !== 'remove') {
      if (outcome.type === 'done') {
        this.forced.delete(id);
        this.deps.emitProgress([this.snapshot(id, job, 'done')]);
      } else if (row) {
        this.save(id, job);
        const next = this.statusAfter(job, outcome);
        this.deps.downloads.update(id, next);
        this.deps.emitProgress([this.snapshot(id, job, next.status)]);
      }
    }
    this.schedule();
  }

  private statusAfter(job: Job, outcome: Outcome): { status: DownloadRecord['status']; error?: string } {
    if (outcome.type === 'failed') {
      // Retries ran out because the network went away: wait for it instead of giving up (DL-7).
      if (outcome.code === DOWNLOAD_ERRORS.network && !this.deps.isOnline()) return { status: 'queued' };
      return { status: 'error', error: outcome.code };
    }
    // Stopped: a pause stays a pause; quitting and going offline put it back in the queue.
    return { status: job.stop === 'pause' ? 'paused' : 'queued' };
  }

  // ------------------------------------------------------------------ errors

  private failureCode(error: unknown): string {
    if (error instanceof RoomError) return error.code;
    if (error instanceof PlanError) {
      if (error.reason === 'live') return DOWNLOAD_ERRORS.live;
      if (error.reason === 'unsupported_encryption') return DOWNLOAD_ERRORS.unsupportedEncryption;
      return error.reason === 'no_stream' ? DOWNLOAD_ERRORS.noStream : DOWNLOAD_ERRORS.unreachable;
    }
    if (error instanceof AppError)
      return error.code === 'not_found' ? DOWNLOAD_ERRORS.noExtension : DOWNLOAD_ERRORS.unreachable;
    if (error instanceof DownloadFetchError) {
      if (error.expired) return DOWNLOAD_ERRORS.expired;
      if (error.code === 'http') return `http_${error.status}`;
      return error.code === 'redirect' ? 'redirect' : DOWNLOAD_ERRORS.network;
    }
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOSPC') return DOWNLOAD_ERRORS.diskFull;
    if (
      code === 'EACCES' ||
      code === 'EPERM' ||
      code === 'EROFS' ||
      code === 'ENOENT' ||
      code === 'ENOTDIR' ||
      code === 'EEXIST'
    )
      return DOWNLOAD_ERRORS.writeFailed;
    this.deps.log?.('download failed', error);
    return (error as Error)?.message?.slice(0, 200) || 'unknown';
  }

  // ------------------------------------------------------------------ files

  /** Stops the download if it runs, deletes its files, then its row. */
  private async discard(row: DownloadRecord, reason: 'cancel' | 'remove'): Promise<void> {
    const job = this.jobs.get(row.id);
    if (job) {
      this.stopJob(job, reason);
      await job.promise;
    }
    // Look again: pausing and finishing may have happened in the meantime.
    const current = this.deps.downloads.get(row.id) ?? row;
    this.forced.delete(row.id);
    this.deps.downloads.delete([row.id]);
    await this.deleteFiles(current);
    this.schedule();
  }

  private async deleteFiles(row: DownloadRecord): Promise<void> {
    const path = row.path;
    if (!path || !isAbsolute(path) || parse(path).root === path) return;
    try {
      if (row.status === 'done') {
        // Only what we made: a folder with our playlist, or an mp4.
        const ours = row.kind === 'mp4' ? path.endsWith('.mp4') : await pathExists(join(path, LOCAL_PLAYLIST));
        if (ours) await removePath(path);
      } else {
        await removePath(tempPath(path, row.kind));
      }
      await pruneEmptyParents(dirname(path), this.folder(this.deps.settings.getAppSettings()));
    } catch (error) {
      this.deps.log?.(`could not delete ${basename(path)}`, error);
    }
  }

  private folder(settings: AppSettings): string {
    return settings.downloadFolder ?? this.deps.defaultFolder();
  }

  private free(folder: string): Promise<number | null> {
    return (this.deps.freeBytes ?? diskFreeBytes)(folder);
  }
}

/** Not enough room (DL-9) or past the size limit (DL-10), found once the size is known. */
class RoomError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const isInside = (root: string, path: string): boolean => {
  const rel = relative(resolve(root), resolve(path));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(sep);
};

/** Renames, or copies and deletes when the folders are on different drives. */
async function moveTree(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await cp(from, to, { recursive: true, errorOnExist: true });
    await rm(from, { recursive: true, force: true });
  }
}
