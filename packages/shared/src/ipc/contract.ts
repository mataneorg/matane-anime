import { z } from 'zod';
import { backupPreviewSchema, backupRestoreResultSchema } from '../backup';
import {
  animeDetailSchema,
  animePageSchema,
  browseInputSchema,
  catalogAnimeSchema,
  cloudflareStatusSchema,
  dbChangedSchema,
  episodeSchema,
  extensionInfoSchema,
  extensionLogEntrySchema,
  filterListSchema,
  networkStatusSchema,
  preferencesStateSchema,
  refreshResultSchema,
  sourceCapabilitiesSchema,
  sourceInfoSchema,
} from '../catalog';
import { changelogEntrySchema } from '../changelog';
import { networkTestInputSchema, networkTestResultSchema, proxyPasswordInfoSchema } from '../network';
import {
  availableExtensionSchema,
  installPreparationSchema,
  repoInfoSchema,
  repoPreviewSchema,
  repoRefreshResultSchema,
  updateAllResultSchema,
} from '../extensions-repo';
import {
  downloadItemSchema,
  downloadProgressSchema,
  downloadStorageSchema,
  enqueueInputSchema,
  enqueueResultSchema,
} from '../downloads';
import {
  autoDownloadModeSchema,
  categorySchema,
  continueTargetSchema,
  historyEntrySchema,
  libraryItemSchema,
  libraryQuerySchema,
  migrationPreviewSchema,
  progressInputSchema,
} from '../library';
import { playbackEventSchema, playbackSessionSchema, playbackUpdateSchema } from '../playback';
import { appSettingsSchema, settingsPatchSchema } from '../settings';
import { updateCheckResultSchema, updateScopeSchema, updateStatusSchema, updatesListSchema } from '../updates';
import { spikeFixtureSchema, spikeRequestLogSchema, spikeResultSchema, spikeStartResultSchema } from '../spike';
import type { EventChannel, InvokeChannel } from './channels';

const invoke = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output });

const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  electron: z.string(),
  chrome: z.string(),
  node: z.string(),
  platform: z.string(),
  /** The playback spike is switched on (MATANE_SPIKE=1 or a development run). */
  spike: z.boolean(),
});
export type AppInfo = z.infer<typeof appInfoSchema>;

/** Renderer → main request/response channels. Inputs are validated in main. */
export const invokeContract = {
  'app.getInfo': invoke(z.void(), appInfoSchema),
  /** The OS locale, e.g. `en-US`. */
  'app.getLocale': invoke(z.void(), z.string()),
  /** Opens an http(s) URL in the system browser. Anything else is refused. */
  'app.openExternal': invoke(z.string(), z.void()),
  'window.minimize': invoke(z.void(), z.void()),
  'window.toggleMaximize': invoke(z.void(), z.void()),
  'window.close': invoke(z.void(), z.void()),
  'window.isMaximized': invoke(z.void(), z.boolean()),
  'settings.get': invoke(z.void(), appSettingsSchema),
  /** Merges the patch into the stored settings and returns the result (also sent as `settings.changed`). */
  'settings.set': invoke(settingsPatchSchema, appSettingsSchema),
  /** Opens the system folder picker; null when cancelled. */
  'dialog.pickFolder': invoke(z.void(), z.string().nullable()),
  'network.getStatus': invoke(z.void(), networkStatusSchema),
  'network.testConnection': invoke(networkTestInputSchema, networkTestResultSchema),
  'network.proxyPasswordInfo': invoke(z.void(), proxyPasswordInfoSchema),
  /** Stores the proxy password (encrypted when the system keyring exists); null removes it. It is never sent back. */
  'network.setProxyPassword': invoke(z.object({ password: z.string().nullable() }), proxyPasswordInfoSchema),
  /** Incognito (PRG-11): while on, nothing is recorded as watched. Kept in memory, off after a restart. */
  'incognito.get': invoke(z.void(), z.boolean()),
  'incognito.set': invoke(z.boolean(), z.boolean()),
  /** Asks where to save, then writes a backup of the user's data; null when cancelled. */
  'backup.export': invoke(z.void(), z.object({ path: z.string() }).nullable()),
  /** Asks for a backup file and reads what it holds without applying it; null when cancelled. */
  'backup.peek': invoke(z.void(), backupPreviewSchema.nullable()),
  'backup.import': invoke(z.object({ token: z.string() }), backupRestoreResultSchema),
  /** The changelog bundled with this version, newest release first. */
  'app.changelog': invoke(z.void(), z.array(changelogEntrySchema)),
  /** Aborts the call that was started with this `requestId`. Unknown ids are ignored. */
  'requests.cancel': invoke(z.string(), z.void()),
  'extensions.list': invoke(z.void(), z.array(extensionInfoSchema)),
  /** Loads (or reloads) an extension from a folder holding `dist/` or `manifest.json` + `index.js`. */
  'extensions.loadDevFolder': invoke(z.object({ folder: z.string() }), extensionInfoSchema),
  'extensions.removeDevFolder': invoke(z.object({ folder: z.string() }), z.void()),
  'extensions.reload': invoke(z.object({ folder: z.string() }), extensionInfoSchema),
  'extensions.logs': invoke(z.object({ extensionId: z.string().optional() }), z.array(extensionLogEntrySchema)),
  'extensions.preferences': invoke(z.object({ extensionId: z.string() }), preferencesStateSchema),
  'extensions.setPreference': invoke(
    z.object({ extensionId: z.string(), key: z.string(), value: z.unknown() }),
    preferencesStateSchema,
  ),
  /** What the added repositories offer, with the install state; 18+ and content languages are applied here (EXT-15). */
  'extensions.available': invoke(z.void(), z.array(availableExtensionSchema)),
  /** Step one of an install (EXT-8): fetches and checks the package and returns what the dialog shows. */
  'extensions.prepareInstall': invoke(
    z.object({ repoId: z.number().int(), extensionId: z.string() }),
    installPreparationSchema,
  ),
  /** Step two: writes what `prepareInstall` checked. */
  'extensions.install': invoke(z.object({ token: z.string() }), z.void()),
  /** Installs the newer version from the repository the extension came from; no dialog (EXT-8). */
  'extensions.update': invoke(z.object({ extensionId: z.string() }), z.void()),
  'extensions.updateAll': invoke(z.void(), updateAllResultSchema),
  /** Removes an installed extension: its files, storage, preferences and session. Sources and anime stay. */
  'extensions.uninstall': invoke(z.object({ extensionId: z.string() }), z.void()),
  'repos.list': invoke(z.void(), z.array(repoInfoSchema)),
  /** Reads a repository's index and checks who signed it, without storing anything. */
  'repos.preview': invoke(z.object({ url: z.string().min(1) }), repoPreviewSchema),
  /** Adds the repository; `trustKey` also trusts the key it signs with (EXT-6). */
  'repos.add': invoke(z.object({ url: z.string().min(1), trustKey: z.boolean() }), repoInfoSchema),
  'repos.remove': invoke(z.object({ id: z.number().int() }), z.void()),
  /** Re-reads one repository, or all of them. */
  'repos.refresh': invoke(z.object({ id: z.number().int().optional() }), repoRefreshResultSchema),
  /** Trusts or stops trusting the key a repository signs with. */
  'repos.setTrust': invoke(z.object({ id: z.number().int(), trusted: z.boolean() }), repoInfoSchema),
  'sources.list': invoke(z.void(), z.array(sourceInfoSchema)),
  'sources.capabilities': invoke(z.object({ sourceId: z.string() }), sourceCapabilitiesSchema),
  'sources.filters': invoke(z.object({ sourceId: z.string(), requestId: z.string().optional() }), filterListSchema),
  'sources.browse': invoke(browseInputSchema, animePageSchema),
  'sources.resolveUrl': invoke(z.object({ sourceId: z.string(), url: z.string() }), catalogAnimeSchema.nullable()),
  'sources.setPinned': invoke(z.object({ sourceId: z.string(), pinned: z.boolean() }), z.void()),
  'anime.get': invoke(z.object({ animeId: z.number().int() }), animeDetailSchema),
  /** Fetches details and the episode list from the source and stores them. */
  'anime.refresh': invoke(
    z.object({ animeId: z.number().int(), requestId: z.string().optional() }),
    refreshResultSchema,
  ),
  'episodes.list': invoke(z.object({ animeId: z.number().int() }), z.array(episodeSchema)),
  'library.list': invoke(libraryQuerySchema, z.array(libraryItemSchema)),
  /** How many anime the library holds (the "All" tab). */
  'library.count': invoke(z.void(), z.number().int()),
  /** Marks every episode of these anime watched or not. */
  'library.markWatched': invoke(z.object({ animeIds: z.array(z.number().int()), watched: z.boolean() }), z.void()),
  /** Adds an anime to the library, in these categories (any number, or none). */
  'library.add': invoke(z.object({ animeId: z.number().int(), categoryIds: z.array(z.number().int()) }), z.void()),
  'library.remove': invoke(z.object({ animeId: z.number().int() }), z.void()),
  'library.setCategories': invoke(
    z.object({ animeIds: z.array(z.number().int()), categoryIds: z.array(z.number().int()) }),
    z.void(),
  ),
  /**
   * Fetches the other anime's episodes and says what would carry over (docs/PRD.md BRW-8). Nothing changes yet.
   */
  'library.migratePreview': invoke(
    z.object({ fromAnimeId: z.number().int(), toAnimeId: z.number().int(), requestId: z.string().optional() }),
    migrationPreviewSchema,
  ),
  /** Moves library membership, categories, history and episode progress to the other anime, by episode number. */
  'library.migrate': invoke(
    z.object({ fromAnimeId: z.number().int(), toAnimeId: z.number().int() }),
    z.object({ animeId: z.number().int(), carried: z.number().int() }),
  ),
  'categories.list': invoke(z.void(), z.array(categorySchema)),
  'categories.create': invoke(z.object({ name: z.string() }), categorySchema),
  'categories.rename': invoke(z.object({ id: z.number().int(), name: z.string() }), z.void()),
  'categories.delete': invoke(z.object({ id: z.number().int() }), z.void()),
  /** The full list of category ids in their new order. */
  'categories.reorder': invoke(z.object({ ids: z.array(z.number().int()) }), z.void()),
  /** Marks a category for auto-download (DL-11); `null` removes the mark. */
  'categories.setAutoDownload': invoke(
    z.object({ id: z.number().int(), mode: autoDownloadModeSchema.nullable() }),
    z.void(),
  ),
  /** Marks episodes watched or not; every variant of the same number follows (PRG-5). */
  'episodes.markWatched': invoke(z.object({ episodeIds: z.array(z.number().int()), watched: z.boolean() }), z.void()),
  /** "Mark all previous as watched" (PRG-7). */
  'episodes.markPrevious': invoke(z.object({ episodeId: z.number().int() }), z.void()),
  'episodes.resetProgress': invoke(z.object({ episodeId: z.number().int() }), z.void()),
  /** The single door for progress, history and watch sessions (PRG-9). Returns whether the episode is now watched. */
  'watch.progress': invoke(progressInputSchema, z.object({ watched: z.boolean() })),
  'watch.continueTarget': invoke(z.object({ animeId: z.number().int() }), continueTargetSchema.nullable()),
  'history.list': invoke(z.void(), z.array(historyEntrySchema)),
  'history.delete': invoke(z.object({ animeId: z.number().int() }), z.void()),
  'history.clear': invoke(z.void(), z.void()),
  /**
   * Picks a stream for an episode (ranked, probed) and opens a session for it. `requestId` lets the
   * renderer cancel while extensions and probes are still working.
   */
  'playback.start': invoke(
    z.object({ episodeId: z.number().int(), requestId: z.string().optional() }),
    playbackSessionSchema,
  ),
  /** The player tells main what happened; on a fatal error main answers with the next stream or gives up. */
  'playback.event': invoke(z.object({ playbackId: z.string(), event: playbackEventSchema }), playbackUpdateSchema),
  /** The user picked a server or quality by hand. Remembered for this anime (STR-5). */
  'playback.switchStream': invoke(
    z.object({ playbackId: z.string(), index: z.number().int(), requestId: z.string().optional() }),
    playbackSessionSchema,
  ),
  'playback.close': invoke(z.object({ playbackId: z.string() }), z.void()),
  /** Keeps the screen on while video plays (PLY-8). */
  'playback.keepAwake': invoke(z.object({ enabled: z.boolean() }), z.void()),
  'downloads.list': invoke(z.void(), z.array(downloadItemSchema)),
  /** Queues episodes (DL-1). Over the size limit they are refused unless `force` is set (DL-10). */
  'downloads.enqueue': invoke(enqueueInputSchema, enqueueResultSchema),
  'downloads.pause': invoke(z.object({ id: z.number().int() }), z.void()),
  'downloads.resume': invoke(z.object({ id: z.number().int() }), z.void()),
  'downloads.pauseAll': invoke(z.void(), z.void()),
  'downloads.resumeAll': invoke(z.void(), z.void()),
  /** Stops an unfinished download and deletes what it saved. */
  'downloads.cancel': invoke(z.object({ id: z.number().int() }), z.void()),
  /** Deletes a download, finished or not, with its files. The episode stays in the library. */
  'downloads.remove': invoke(z.object({ id: z.number().int() }), z.void()),
  'downloads.retry': invoke(z.object({ id: z.number().int() }), z.void()),
  /** The new queue order, as download ids; ids left out keep their place after these. */
  'downloads.reorder': invoke(z.object({ ids: z.array(z.number().int()) }), z.void()),
  'downloads.clearFailed': invoke(z.void(), z.void()),
  'downloads.storage': invoke(z.void(), downloadStorageSchema),
  /** Changes where new downloads go; `move` also moves the finished ones and rewrites their paths. */
  'downloads.changeFolder': invoke(z.object({ folder: z.string().min(1), move: z.boolean() }), z.void()),
  'downloads.openFolder': invoke(z.void(), z.void()),
  'updates.list': invoke(z.void(), updatesListSchema),
  /** How many new episodes are waiting: the sidebar badge (UPD-8). */
  'updates.count': invoke(z.void(), z.number().int()),
  'updates.check': invoke(
    z.object({ scope: updateScopeSchema, requestId: z.string().optional() }),
    updateCheckResultSchema,
  ),
  /** Fills the library with test data for performance checks. Only in development or with MATANE_SPIKE=1. */
  'dev.seedLibrary': invoke(
    z.object({ anime: z.number().int().min(1).max(5000), episodesPerAnime: z.number().int().min(1).max(200) }),
    z.void(),
  ),
  'spike.fixtures': invoke(z.void(), z.array(spikeFixtureSchema)),
  'spike.start': invoke(z.object({ id: z.string() }), spikeStartResultSchema),
  /** Every request the fake site has served since the last reset (to check `Range` and `Referer`). */
  'spike.stats': invoke(z.void(), z.array(spikeRequestLogSchema)),
  'spike.reset': invoke(z.void(), z.void()),
  'spike.report': invoke(spikeResultSchema, z.void()),
} satisfies Record<InvokeChannel, { input: z.ZodType; output: z.ZodType }>;

/** Main → renderer events. */
export const eventContract = {
  'window.maximizeChanged': z.boolean(),
  'settings.changed': appSettingsSchema,
  'db.changed': dbChangedSchema,
  'network.status': networkStatusSchema,
  'incognito.changed': z.boolean(),
  'extensions.log': extensionLogEntrySchema,
  'cloudflare.status': cloudflareStatusSchema,
  'downloads.progress': z.array(downloadProgressSchema),
  'updates.status': updateStatusSchema,
  'app.navigate': z.object({ to: z.enum(['/updates', '/downloads', '/library']) }),
} satisfies Record<EventChannel, z.ZodType>;

export type InvokeInput<C extends InvokeChannel> = z.input<(typeof invokeContract)[C]['input']>;
export type InvokeOutput<C extends InvokeChannel> = z.output<(typeof invokeContract)[C]['output']>;
export type EventPayload<C extends EventChannel> = z.output<(typeof eventContract)[C]>;

/** Shape exposed on `window.api` by the preload script. */
export interface IpcApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeInput<C> extends void | undefined
      ? []
      : undefined extends InvokeInput<C>
        ? [input?: InvokeInput<C>]
        : [input: InvokeInput<C>]
  ): Promise<InvokeOutput<C>>;
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): () => void;
}
