import type { UrlKind } from '@matane-anime/extension-sdk';
import {
  AppError,
  type UpdateCheckResult,
  type UpdateScope,
  type UpdateStatus,
  type UpdatesList,
} from '@matane-anime/shared';
import type { UpdatesRepository } from '../db/repositories/updates';
import type { SettingsRepository } from '../db/repositories/settings';
import type { RequestRegistry } from '../ipc/requests';
import { newEpisodesText, resolveLanguage } from './messages';
import { UPDATE_CONCURRENCY, runPool } from './pool';
import { autoDownloadAllowed, onePerNumber, skipReason } from './rules';
import { UpdateScheduler } from './schedule';

/** Settings-table keys of the checker's own state (not part of `AppSettings`). */
export const LAST_RUN_KEY = 'updates.lastRunAt';
export const EXTENSION_VERSIONS_KEY = 'updates.extensionVersions';

/** What the checker needs from `ExtensionService`. */
export interface UpdateExtensions {
  /** Refreshes an anime from its source; `addedEpisodeIds` are the episodes that were new this time. */
  refreshForUpdate(animeId: number, signal?: AbortSignal): Promise<{ addedEpisodeIds: number[] }>;
  extensionVersions(): Record<string, string>;
  supportsMigrateUrl(sourceId: string): Promise<boolean>;
  migrateUrl(sourceId: string, url: string, kind: UrlKind, fromVersion: string): Promise<string | null>;
}

export interface UpdateNotification {
  title: string;
  body: string;
  onClick(): void;
}

export interface UpdateServiceDeps {
  repo: UpdatesRepository;
  settings: SettingsRepository;
  extensions: UpdateExtensions;
  requests: Pick<RequestRegistry, 'begin'>;
  emitStatus(status: UpdateStatus): void;
  /** Queues these episodes for download (DL-11); wired to `DownloadService.enqueue(…, { reason: 'auto' })`. */
  autoDownload(episodeIds: number[]): Promise<void>;
  notify(notification: UpdateNotification): void;
  /** Clicking the notification: bring the window forward and open `/updates`. */
  navigate(): void;
  isWindowFocused(): boolean;
  systemLocale(): string;
  isOnline(): boolean;
  onOnlineChange(listener: (online: boolean) => void): () => void;
  log?: { warn(message: string, error?: unknown): void };
  now?(): number;
  concurrency?: number;
  /** Test hooks for the scheduler's timer. */
  setTimer?(callback: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

interface RunOptions {
  /** Started by the schedule, not by the user: always notifies, whatever the window is doing. */
  automatic: boolean;
  requestId?: string;
}

/**
 * Finds new episodes of the library (docs/PRD.md UPD-1…8): the schedule, the checks (all, a category, one anime),
 * and what follows a check. What counts as a "new episode" is derived from the database (`UpdatesRepository`);
 * this only refreshes the anime so the episode lists are current, and reacts to what turned up.
 */
export class UpdateService {
  private readonly scheduler: UpdateScheduler;
  /** The library-wide check in progress, which a second request joins instead of starting another. */
  private current: Promise<UpdateCheckResult> | null = null;

  constructor(private readonly deps: UpdateServiceDeps) {
    const now = () => deps.now?.() ?? Date.now();
    this.scheduler = new UpdateScheduler({
      now,
      intervalHours: () => deps.settings.getAppSettings().updateIntervalHours,
      lastRunAt: () => deps.settings.getValue<number | null>(LAST_RUN_KEY, null),
      saveLastRunAt: (at) => deps.settings.setValue(LAST_RUN_KEY, at),
      isOnline: deps.isOnline,
      onOnlineChange: deps.onOnlineChange,
      run: () => this.execute({ kind: 'all' }, { automatic: true }),
      onError: (error) => deps.log?.warn('scheduled update check failed', error),
      ...(deps.setTimer && { setTimer: deps.setTimer }),
      ...(deps.clearTimer && { clearTimer: deps.clearTimer }),
    });
  }

  /** Starts the schedule. Call once the extensions have loaded (`registry.init()`). */
  start(): void {
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
  }

  /** The settings changed (interval): look at the schedule again. */
  reschedule(): void {
    this.scheduler.reschedule();
  }

  list(): UpdatesList {
    return this.deps.repo.list(this.now());
  }

  count(): number {
    return this.deps.repo.count(this.now());
  }

  /** A check the user asked for. Rejects with `cancelled` when `requests.cancel(requestId)` stops it. */
  check(scope: UpdateScope, requestId?: string): Promise<UpdateCheckResult> {
    return this.execute(scope, { automatic: false, ...(requestId !== undefined && { requestId }) });
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private execute(scope: UpdateScope, options: RunOptions): Promise<UpdateCheckResult> {
    // One library-wide check at a time. A single anime can always be checked: the user is looking at it.
    if (scope.kind !== 'anime') {
      if (this.current) return this.current;
      const run = this.run(scope, options, true).finally(() => {
        if (this.current === run) this.current = null;
      });
      this.current = run;
      return run;
    }
    return this.run(scope, options, this.current === null);
  }

  private async run(scope: UpdateScope, options: RunOptions, reportStatus: boolean): Promise<UpdateCheckResult> {
    const { repo, settings, extensions } = this.deps;
    const request = this.deps.requests.begin(options.requestId);
    const { signal } = request;
    try {
      await this.migrateUrls(signal);

      let targets = repo.targets(scope);
      if (scope.kind === 'anime' && targets.length === 0) throw new AppError('not_found', 'No such anime');
      let skipped = 0;
      if (scope.kind !== 'anime') {
        const rules = settings.getAppSettings();
        const facts = repo.facts(targets.map((target) => target.animeId));
        targets = targets.filter((target) => {
          const known = facts.get(target.animeId);
          const reason = known ? skipReason({ status: target.status, ...known }, rules) : null;
          if (reason !== null) skipped++;
          return reason === null;
        });
      }

      const total = targets.length;
      let done = 0;
      const status = (checking: boolean): void => {
        if (reportStatus) this.deps.emitStatus({ checking, done, total });
      };
      status(true);
      const outcomes = await runPool(
        targets,
        async (target, _index, poolSignal) => {
          try {
            const { addedEpisodeIds } = await extensions.refreshForUpdate(target.animeId, poolSignal);
            repo.markChecked(target.animeId, this.now(), null);
            return addedEpisodeIds;
          } catch (error) {
            // A cancelled check leaves no mark: the anime was not looked at, and did not fail either.
            if (!poolSignal?.aborted) repo.markChecked(target.animeId, this.now(), errorMessage(error));
            throw error;
          } finally {
            done++;
            status(true);
          }
        },
        { concurrency: this.deps.concurrency ?? UPDATE_CONCURRENCY, signal },
      );
      status(false);
      if (signal.aborted) throw new AppError('cancelled', 'The update check was cancelled');

      const newIds = outcomes.flatMap((outcome) => (outcome.status === 'ok' ? outcome.value : []));
      const found = onePerNumber(repo.describeEpisodes(newIds));
      const result: UpdateCheckResult = {
        checked: outcomes.filter((outcome) => outcome.status === 'ok').length,
        skipped,
        newEpisodes: found.length,
        failed: outcomes.filter((outcome) => outcome.status === 'error').length,
      };
      if (found.length > 0) {
        // UPD-6: auto-download first, then tell the user.
        await this.autoDownload(found);
        this.notify(found, options);
      }
      return result;
    } finally {
      request.done();
    }
  }

  // ------------------------------------------------------------------ UPD-6a: url migration

  /**
   * An extension whose version changed since the last look may have changed how its urls look: ask it to
   * rewrite the urls of the library's anime and episodes (`migrateUrl`). Runs before the anime are refreshed:
   * a stale url would fail the refresh. The version is remembered only once the migration went through, so
   * a failure is tried again at the next check. Extensions without `migrateUrl` are passed over silently.
   */
  private async migrateUrls(signal: AbortSignal): Promise<void> {
    const { settings, extensions } = this.deps;
    const current = extensions.extensionVersions();
    const known = settings.getValue<Record<string, string>>(EXTENSION_VERSIONS_KEY, {});
    const next = { ...known };
    for (const [extensionId, version] of Object.entries(current)) {
      const previous = known[extensionId];
      if (previous === version) continue;
      if (previous !== undefined) {
        try {
          await this.migrateExtension(extensionId, previous, signal);
        } catch (error) {
          this.deps.log?.warn(`could not migrate the urls of ${extensionId}`, error);
          continue;
        }
      }
      next[extensionId] = version;
    }
    if (Object.keys(next).some((id) => next[id] !== known[id])) settings.setValue(EXTENSION_VERSIONS_KEY, next);
  }

  private async migrateExtension(extensionId: string, fromVersion: string, signal: AbortSignal): Promise<void> {
    const { repo, extensions } = this.deps;
    const { anime, episodes } = repo.urlsOfExtension(extensionId);
    const sourceId = anime[0]?.sourceId ?? episodes[0]?.sourceId;
    if (!sourceId || !(await extensions.supportsMigrateUrl(sourceId))) return;
    for (const [kind, rows] of [
      ['anime', anime],
      ['episode', episodes],
    ] as const) {
      for (const row of rows) {
        if (signal.aborted) throw new AppError('cancelled', 'The update check was cancelled');
        const url = await extensions.migrateUrl(row.sourceId, row.url, kind, fromVersion);
        if (url !== null && !repo.rewriteUrl(kind, row.id, url)) {
          this.deps.log?.warn(`${kind} ${row.id}: ${url} already exists, url not migrated`);
        }
      }
    }
  }

  // ------------------------------------------------------------------ UPD-6b: auto-download

  private async autoDownload(found: EpisodeInfo[]): Promise<void> {
    const { repo, settings } = this.deps;
    if (!settings.getAppSettings().autoDownload) return;
    const modes = repo.autoDownloadModes();
    const categories = repo.categoryIds([...new Set(found.map((episode) => episode.animeId))]);
    const allowed = found.filter((episode) => autoDownloadAllowed(categories.get(episode.animeId) ?? [], modes));
    const ids = repo.withoutDownload(allowed.map((episode) => episode.episodeId));
    if (ids.length === 0) return;
    try {
      await this.deps.autoDownload(ids);
    } catch (error) {
      // The episodes are in Updates and can be downloaded by hand; the check itself succeeded.
      this.deps.log?.warn('auto-download failed', error);
    }
  }

  // ------------------------------------------------------------------ UPD-6c / UPD-7: notification

  private notify(found: EpisodeInfo[], options: RunOptions): void {
    // A check the user started shows its result on screen; only tell them if they are looking elsewhere.
    if (!options.automatic && this.deps.isWindowFocused()) return;
    const titles = new Set(found.map((episode) => episode.animeTitle));
    const language = resolveLanguage(this.deps.settings.getAppSettings().language, this.deps.systemLocale());
    const text = newEpisodesText(
      {
        episodes: found.length,
        anime: new Set(found.map((episode) => episode.animeId)).size,
        ...(titles.size === 1 && { title: [...titles][0] as string }),
      },
      language,
    );
    try {
      this.deps.notify({ ...text, onClick: () => this.deps.navigate() });
    } catch (error) {
      this.deps.log?.warn('notification failed', error);
    }
  }
}

type EpisodeInfo = ReturnType<UpdatesRepository['describeEpisodes']>[number];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
