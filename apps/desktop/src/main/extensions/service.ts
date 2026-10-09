import {
  type CallOptions,
  ExtensionRuntimeError,
  type SourceBackend,
  SourceClient,
} from '@matane-anime/extension-runtime/client';
import type { FilterState, Preference, Stream, UrlKind } from '@matane-anime/extension-sdk';
import {
  AppError,
  type AnimeDetail,
  type BrowseInput,
  type CatalogAnime,
  type CatalogPage,
  type EpisodeRow,
  type PreferencesState,
  type RefreshResult,
  type SourceCapabilities,
  type SourceInfo,
} from '@matane-anime/shared';
import type { AnimeRepository, AnimeRow } from '../db/repositories/anime';
import type { EpisodeRecord, EpisodesRepository } from '../db/repositories/episodes';
import type { ExtensionStore } from '../db/repositories/extension-store';
import type { SettingsRepository } from '../db/repositories/settings';
import { type RequestRegistry, abortable } from '../ipc/requests';
import type { NetworkManager } from '../network/manager';
import { allowsLanguage, allowsNsfw } from './content-filter';
import { toAppError } from './errors';
import type { BrowseCache } from '../browse/cache';
import type { ExtensionHostClient } from './host-client';
import type { ExtensionRecord, ExtensionRegistry } from './registry';

export interface ServiceDeps {
  registry: ExtensionRegistry;
  host: ExtensionHostClient;
  store: ExtensionStore;
  /** `showNsfw` and `contentLanguages` (EXT-15). */
  settings: Pick<SettingsRepository, 'getAppSettings'>;
  anime: AnimeRepository;
  episodes: EpisodesRepository;
  network: NetworkManager;
  requests: RequestRegistry;
  /** Called after a refresh stored new details; the library keeps its permanent cover up to date with it. */
  onRefreshed?(row: AnimeRow, previousThumbnail: string | null): void;
  /** First pages of Popular and Latest kept between runs; without it Browse always waits for the site. */
  browseCache?: BrowseCache;
  /** The library categories an anime is in. */
  categoryIdsOf(animeId: number): number[];
}

interface Resolved {
  client: SourceClient;
  record: ExtensionRecord;
  sourceKey: string;
  extensionId: string;
}

const toCatalog = (row: AnimeRow): CatalogAnime => ({
  animeId: row.id,
  sourceId: row.sourceId,
  url: row.url,
  title: row.title,
  thumbnailUrl: row.thumbnailUrl,
  inLibrary: row.inLibrary,
});

/** What a listing is remembered under: the first page of Popular or Latest. Searches and later pages are not. */
const listingKey = (input: BrowseInput): string | null =>
  input.page === 1 && input.kind !== 'search' ? `${input.sourceId}|${input.kind}` : null;

const toEpisode = (row: EpisodeRecord): EpisodeRow => ({
  id: row.id,
  animeId: row.animeId,
  url: row.url,
  name: row.name,
  number: row.number,
  variant: row.variant,
  uploadedAt: row.uploadedAt,
  sourceOrder: row.sourceOrder,
  watched: row.watched,
  positionMs: row.positionMs,
  durationMs: row.durationMs,
  sourceMissing: row.sourceMissing,
});

function parseList(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Only well-formed filter values reach the extension. */
function sanitizeFilters(filters: Record<string, unknown> | undefined): FilterState {
  const out: FilterState = {};
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (typeof value === 'string' || typeof value === 'boolean') out[key] = value;
    else if (
      value &&
      typeof value === 'object' &&
      typeof (value as { value?: unknown }).value === 'string' &&
      typeof (value as { ascending?: unknown }).ascending === 'boolean'
    ) {
      out[key] = value as { value: string; ascending: boolean };
    }
  }
  return out;
}

/** Stream URLs expire quickly, so they are only kept in memory, and not for long (docs/PRD.md STR-6). */
const STREAM_TTL_MS = 2 * 60_000;

/**
 * Everything the renderer asks of extensions, in one place: it finds the extension behind a source, calls it
 * through the host process, validates what comes back, stores it, and turns failures into `AppError`s.
 */
export class ExtensionService {
  private readonly deps: ServiceDeps;
  private readonly streamCache = new Map<string, { at: number; streams: Stream[] }>();

  constructor(deps: ServiceDeps) {
    this.deps = deps;
  }

  // ------------------------------------------------------------------ sources

  /**
   * The sources the user may see: 18+ sources only with `showNsfw`, and only languages in `contentLanguages`
   * (empty means all, `multi` always passes). This is where EXT-15 is enforced, not in the renderer.
   */
  listSources(): SourceInfo[] {
    const { registry, store } = this.deps;
    const preferences = this.deps.settings.getAppSettings();
    const out: SourceInfo[] = [];
    for (const row of store.listSources()) {
      const record = registry.byExtensionId(row.extensionId);
      const known = store.getExtension(row.extensionId);
      const nsfw = record?.manifest?.nsfw ?? known?.nsfw ?? row.nsfw;
      if (!allowsNsfw(preferences, nsfw) || !allowsLanguage(preferences.contentLanguages, row.lang)) continue;
      out.push({
        id: row.id,
        extensionId: row.extensionId,
        extensionName: record?.manifest?.name ?? known?.name ?? row.extensionId,
        key: row.key,
        lang: row.lang,
        name: row.name,
        nsfw,
        pinned: row.pinned,
        lastUsedAt: row.lastUsedAt,
        available: record?.status === 'ready' && record.manifest?.sources.some((s) => s.key === row.key) === true,
      });
    }
    return out;
  }

  /** Browsing an 18+ source needs `showNsfw` (EXT-15). */
  private assertBrowsable(sourceId: string, nsfw: boolean): void {
    if (!allowsNsfw(this.deps.settings.getAppSettings(), nsfw)) {
      throw new AppError(
        'forbidden',
        `"${sourceId}" is an 18+ source. Turn on "Show 18+ sources" in Settings to use it.`,
      );
    }
  }

  setPinned(sourceId: string, pinned: boolean): void {
    this.deps.store.setPinned(sourceId, pinned);
  }

  async capabilities(sourceId: string): Promise<SourceCapabilities> {
    const { client } = this.resolve(sourceId);
    return this.guard(async () => ({
      latest: await client.supports('getLatest'),
      filters: await client.supports('getFilters'),
      resolveUrl: await client.supports('resolveUrl'),
    }));
  }

  async filters(sourceId: string, requestId?: string) {
    const { client, record } = this.resolve(sourceId);
    this.assertBrowsable(sourceId, record.manifest?.nsfw ?? false);
    return this.run(requestId, () => client.getFilters(this.options(sourceId)));
  }

  async browse(input: BrowseInput): Promise<CatalogPage> {
    const { client, record } = this.resolve(input.sourceId);
    this.assertBrowsable(input.sourceId, record.manifest?.nsfw ?? false);
    const options = this.options(input.sourceId);
    const page = await this.run(input.requestId, () => {
      if (input.kind === 'latest') return client.getLatest(input.page, options);
      if (input.kind === 'search') {
        return client.search(input.query ?? '', input.page, sanitizeFilters(input.filters), options);
      }
      return client.getPopular(input.page, options);
    });
    const rows = this.deps.anime.upsertSummaries(input.sourceId, page.items);
    this.deps.store.touchSource(input.sourceId);
    const key = listingKey(input);
    // A failed write only means the next start has nothing to show early.
    if (key && rows.length > 0) {
      void this.deps.browseCache
        ?.put(
          key,
          rows.map((row) => row.id),
          page.hasNextPage,
        )
        .catch(() => undefined);
    }
    return { items: rows.map(toCatalog), hasNextPage: page.hasNextPage };
  }

  /**
   * The first page of Popular or Latest as it was last seen, for showing while the real one loads. Null when
   * there is none (never seen, too old, a search, or rows that have since been purged).
   */
  async cachedBrowse(input: BrowseInput): Promise<CatalogPage | null> {
    const key = listingKey(input);
    if (!key || !this.deps.browseCache) return null;
    const { record } = this.resolve(input.sourceId);
    this.assertBrowsable(input.sourceId, record.manifest?.nsfw ?? false);
    const listing = await this.deps.browseCache.get(key);
    if (!listing) return null;
    const rows = listing.ids.flatMap((id) => this.deps.anime.get(id) ?? []);
    return rows.length > 0 ? { items: rows.map(toCatalog), hasNextPage: listing.hasNextPage } : null;
  }

  async resolveUrl(sourceId: string, url: string): Promise<CatalogAnime | null> {
    const { client, record } = this.resolve(sourceId);
    this.assertBrowsable(sourceId, record.manifest?.nsfw ?? false);
    const summary = await this.guard(() => client.resolveUrl(url, this.options(sourceId)));
    if (!summary) return null;
    const [row] = this.deps.anime.upsertSummaries(sourceId, [summary]);
    return row ? toCatalog(row) : null;
  }

  // ------------------------------------------------------------------ anime and episodes

  async getAnime(animeId: number): Promise<AnimeDetail> {
    const row = this.requireAnime(animeId);
    return this.detail(row, await this.webUrlOf(row));
  }

  listEpisodes(animeId: number): EpisodeRow[] {
    this.requireAnime(animeId);
    return this.deps.episodes.list(animeId).map(toEpisode);
  }

  /** Details and the episode list from the source. On failure nothing is written, so old data survives. */
  async refresh(animeId: number, requestId?: string): Promise<RefreshResult> {
    return (await this.refreshAnime(animeId, (work) => this.run(requestId, work))).result;
  }

  /**
   * `refresh` for the update checker: cancelled through a signal rather than a request id, and it also
   * reports which episodes were new this time (UPD-4), so the checker can notify and download only those.
   */
  async refreshForUpdate(animeId: number, signal?: AbortSignal): Promise<{ addedEpisodeIds: number[] }> {
    const { addedEpisodeIds } = await this.refreshAnime(animeId, (work) =>
      signal ? abortable(this.guard(work), signal) : this.guard(work),
    );
    return { addedEpisodeIds };
  }

  private async refreshAnime(
    animeId: number,
    run: <T>(work: () => Promise<T>) => Promise<T>,
  ): Promise<{ result: RefreshResult; addedEpisodeIds: number[] }> {
    const row = this.requireAnime(animeId);
    const { client } = this.resolve(row.sourceId);
    const options = this.options(row.sourceId);
    const summary = { url: row.url, title: row.title, ...(row.thumbnailUrl && { thumbnailUrl: row.thumbnailUrl }) };
    const [details, episodes] = await run(() =>
      Promise.all([client.getAnimeDetails(summary, options), client.getEpisodes(summary, options)]),
    );
    // Read again: the anime may have joined the library while the site was answering. If its first fetch ever
    // lands after that, the list is what it had when it was added, not news (UPD-4).
    const current = this.requireAnime(animeId);
    const baselineAt =
      current.inLibrary && current.addedAt !== null && current.lastUpdateCheckAt === null ? current.addedAt : undefined;
    const sync = this.deps.episodes.sync(animeId, episodes, Date.now(), baselineAt);
    this.deps.anime.saveDetails(animeId, details, Date.now(), sync.latestUploadedAt);
    this.deps.store.touchSource(row.sourceId);
    const saved = this.requireAnime(animeId);
    this.deps.onRefreshed?.(saved, row.thumbnailUrl);
    return {
      result: {
        anime: this.detail(saved, await this.webUrlOf(saved)),
        episodes: this.deps.episodes.list(animeId).map(toEpisode),
      },
      addedEpisodeIds: sync.addedIds,
    };
  }

  // ------------------------------------------------------------------ url migration (UPD-6)

  /** Versions of the extensions that are loaded, by extension id. */
  extensionVersions(): Record<string, string> {
    const versions: Record<string, string> = {};
    for (const info of this.deps.registry.list()) {
      if (info.status === 'ready' && info.version) versions[info.id] = info.version;
    }
    return versions;
  }

  /** Whether the source's extension can rewrite stored urls (`migrateUrl`). False if it is not loaded. */
  async supportsMigrateUrl(sourceId: string): Promise<boolean> {
    try {
      const { client } = this.resolve(sourceId);
      return await this.guard(() => client.supports('migrateUrl'));
    } catch {
      return false;
    }
  }

  /** The new form of a url written by `fromVersion` of the extension, or null to keep it. */
  async migrateUrl(sourceId: string, url: string, kind: UrlKind, fromVersion: string): Promise<string | null> {
    const { client } = this.resolve(sourceId);
    return this.guard(() => client.migrateUrl(url, kind, fromVersion, this.options(sourceId)));
  }

  // ------------------------------------------------------------------ streams

  /**
   * The streams an extension offers for an episode, from memory if they are under two minutes old.
   * `fresh` skips the cache: an expired link needs a new one (STR-4).
   */
  async streamsFor(row: AnimeRow, episode: EpisodeRecord, fresh: boolean): Promise<Stream[]> {
    const key = `${row.sourceId}|${episode.url}`;
    const hit = this.streamCache.get(key);
    if (!fresh && hit && Date.now() - hit.at < STREAM_TTL_MS) return hit.streams;
    const { client } = this.resolve(row.sourceId);
    const streams = await this.guard(() =>
      client.getStreams(
        {
          url: episode.url,
          name: episode.name,
          ...(episode.number !== null && { number: episode.number }),
          ...(episode.variant !== null && { variant: episode.variant }),
          ...(episode.uploadedAt !== null && { uploadedAt: episode.uploadedAt }),
        },
        this.options(row.sourceId),
      ),
    );
    this.streamCache.set(key, { at: Date.now(), streams });
    return streams;
  }

  /** Throws `not_found` unless the source's extension is loaded. */
  assertAvailable(sourceId: string): void {
    this.resolve(sourceId);
  }

  // ------------------------------------------------------------------ preferences

  async preferences(extensionId: string): Promise<PreferencesState> {
    const record = this.requireExtension(extensionId);
    const declared = await this.guard(() => this.preferencesOf(record));
    return {
      preferences: declared,
      values: {
        ...Object.fromEntries(declared.map((p) => [p.key, p.default])),
        ...this.deps.store.getPrefs(extensionId),
      },
    };
  }

  async setPreference(extensionId: string, key: string, value: unknown): Promise<PreferencesState> {
    const record = this.requireExtension(extensionId);
    const declared = await this.guard(() => this.preferencesOf(record));
    const preference = declared.find((p) => p.key === key);
    if (!preference) throw new AppError('invalid_input', `${extensionId} has no preference "${key}"`);
    if (!acceptsValue(preference, value)) throw new AppError('invalid_input', `Not a valid value for "${key}"`);
    this.deps.store.setPref(extensionId, key, value);
    return this.preferences(extensionId);
  }

  // ------------------------------------------------------------------ internals

  private requireExtension(extensionId: string): ExtensionRecord {
    const record = this.deps.registry.byExtensionId(extensionId);
    if (!record) throw new AppError('not_found', `The extension "${extensionId}" is not loaded`);
    return record;
  }

  private requireAnime(animeId: number): AnimeRow {
    const row = this.deps.anime.get(animeId);
    if (!row) throw new AppError('not_found', `No anime with id ${animeId}`);
    return row;
  }

  private resolve(sourceId: string): Resolved {
    const [extensionId, ...rest] = sourceId.split('/');
    const sourceKey = rest.join('/');
    const record = extensionId ? this.deps.registry.byExtensionId(extensionId) : undefined;
    if (!record?.manifest || !record.manifest.sources.some((s) => s.key === sourceKey)) {
      throw new AppError('not_found', `The source "${sourceId}" is not installed`);
    }
    return {
      client: new SourceClient(this.backend(record), sourceKey),
      record,
      sourceKey,
      extensionId: record.manifest.id,
    };
  }

  /** Preferences with their defaults, in the form the sandbox's `prefs.get` expects. */
  private options(sourceId: string): CallOptions {
    const extensionId = sourceId.split('/')[0] as string;
    const record = this.deps.registry.byExtensionId(extensionId);
    const defaults = Object.fromEntries((record?.preferences ?? []).map((p) => [p.key, p.default]));
    return { prefs: { ...defaults, ...this.deps.store.getPrefs(extensionId) } };
  }

  private async preferencesOf(record: ExtensionRecord): Promise<Preference[]> {
    const sourceKey = record.manifest?.sources[0]?.key ?? '';
    return new SourceClient(this.backend(record), sourceKey).preferences();
  }

  /** Calls go to the host process; if it dropped the extension while idle, load it again and retry once. */
  private backend(record: ExtensionRecord): SourceBackend {
    const { registry, host } = this.deps;
    const id = record.manifest?.id as string;
    const withLoaded = async <T>(work: () => Promise<T>): Promise<T> => {
      await registry.ensureLoaded(record);
      try {
        return await work();
      } catch (error) {
        if (!(error instanceof ExtensionRuntimeError) || error.code !== 'not_loaded') throw error;
        registry.markUnloaded(record);
        await registry.ensureLoaded(record);
        return work();
      }
    };
    return {
      call: (sourceKey, method, args, options) =>
        withLoaded(() =>
          host.send({
            type: 'call',
            extensionId: id,
            sourceKey,
            method,
            args,
            prefs: options?.prefs ?? {},
            ...(options?.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
          }),
        ),
      supports: (sourceKey, method) =>
        withLoaded(() => host.send({ type: 'supports', extensionId: id, sourceKey, method })) as Promise<boolean>,
      preferences: () => withLoaded(() => host.send({ type: 'preferences', extensionId: id })),
    };
  }

  /** Runs a call that the renderer may cancel, and maps failures. */
  private run<T>(requestId: string | undefined, work: () => Promise<T>): Promise<T> {
    const request = this.deps.requests.begin(requestId);
    return abortable(this.guard(work), request.signal).finally(request.done);
  }

  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw toAppError(error, this.deps.network.status.isOnline);
    }
  }

  private detail(row: AnimeRow, webUrl: string | null): AnimeDetail {
    return {
      animeId: row.id,
      sourceId: row.sourceId,
      sourceName: this.deps.store.getSource(row.sourceId)?.name ?? null,
      url: row.url,
      title: row.title,
      altTitles: parseList(row.altTitlesJson),
      description: row.description,
      genres: parseList(row.genresJson),
      studio: row.studio,
      year: row.year,
      status: row.status,
      type: row.type,
      thumbnailUrl: row.thumbnailUrl,
      inLibrary: row.inLibrary,
      categoryIds: this.deps.categoryIdsOf(row.id),
      detailsFetchedAt: row.lastUpdateCheckAt,
      webUrl,
    };
  }

  /** `getWebUrl` of the source, if the extension is loaded and implements it; never fails the caller. */
  private async webUrlOf(row: AnimeRow): Promise<string | null> {
    try {
      const { client } = this.resolve(row.sourceId);
      return await client.getWebUrl(
        { url: row.url, title: row.title },
        { ...this.options(row.sourceId), timeoutMs: 3000 },
      );
    } catch {
      return null;
    }
  }
}

function acceptsValue(preference: Preference, value: unknown): boolean {
  switch (preference.type) {
    case 'switch':
      return typeof value === 'boolean';
    case 'text':
      return typeof value === 'string' && value.length <= 2000;
    case 'select':
      return typeof value === 'string' && preference.options.some((option) => option.value === value);
    case 'multiselect':
      return (
        Array.isArray(value) &&
        value.every((item) => typeof item === 'string' && preference.options.some((option) => option.value === item))
      );
  }
}
