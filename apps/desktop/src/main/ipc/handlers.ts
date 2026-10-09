import { mkdir } from 'node:fs/promises';
import { AppError, type AppSettings } from '@matane-anime/shared';
import { BrowserWindow, app, dialog, shell } from 'electron';
import type { BackupService } from '../backup/service';
import type { SettingsRepository } from '../db/repositories/settings';
import type { InstallService } from '../extensions/install';
import type { ExtensionLogs } from '../extensions/logs';
import type { RepoService } from '../extensions/repos';
import type { ExtensionRegistry } from '../extensions/registry';
import type { ExtensionService } from '../extensions/service';
import type { NetworkApplier } from '../network/apply';
import { NETWORK_SETTING_KEYS } from '../network/config';
import type { NetworkManager } from '../network/manager';
import type { ProxyPasswordStore } from '../network/proxy-password';
import type { LibraryRepository } from '../db/repositories/library';
import type { MigrationService } from '../library/migration';
import type { LibraryService } from '../library/service';
import type { DownloadService } from '../downloads/service';
import type { PlaybackService } from '../playback/service';
import type { UpdateService } from '../updates/service';
import type { IncognitoState } from '../watch/incognito';
import type { WatchService } from '../watch/service';
import type { SpikeApi } from '../playback/spike/api';
import { type IpcHandlers, broadcast } from './register';
import type { RequestRegistry } from './requests';

export interface HandlerDeps {
  settings: SettingsRepository;
  registry: ExtensionRegistry;
  service: ExtensionService;
  repos: RepoService;
  installs: InstallService;
  logs: ExtensionLogs;
  network: NetworkManager;
  /** Puts the proxy and DoH settings to work, and runs the connection test. */
  networkApplier: NetworkApplier;
  proxyPassword: ProxyPasswordStore;
  requests: RequestRegistry;
  playback: PlaybackService;
  watch: WatchService;
  incognito: IncognitoState;
  library: LibraryService;
  downloads: DownloadService;
  updates: UpdateService;
  libraryRepo: LibraryRepository;
  migration: MigrationService;
  backup: BackupService;
  /** Applies `closeToTray` and `runAtLogin` (the tray and the login item). */
  applySystemSettings(settings: AppSettings): void;
  /** Fills the library for performance checks (development only). */
  seedLibrary(anime: number, episodesPerAnime: number): void;
  /** Null unless the spike is switched on (development, or MATANE_SPIKE=1). */
  spike: SpikeApi | null;
}

export function createHandlers({
  settings,
  registry,
  service,
  repos,
  installs,
  logs,
  network,
  networkApplier,
  proxyPassword,
  requests,
  playback,
  watch,
  incognito,
  library,
  downloads,
  updates,
  libraryRepo,
  migration,
  backup,
  applySystemSettings,
  seedLibrary,
  spike,
}: HandlerDeps): IpcHandlers {
  // Phase 5 channels whose service arrives in a later milestone: refused until then, like the repos in phase 4a.
  const notYet = (what: string) => (): never => {
    throw new AppError('unsupported', `${what} is not available yet`);
  };

  const requireSpike = (): SpikeApi => {
    if (!spike)
      throw new AppError('disabled', 'The playback spike is only available in development or with MATANE_SPIKE=1');
    return spike;
  };

  return {
    'app.getInfo': () => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      spike: spike !== null,
    }),
    'app.getLocale': () => app.getLocale(),
    'app.openExternal': async (url) => {
      if (!/^https?:\/\//i.test(url)) throw new AppError('invalid_input', 'Only http and https links can be opened');
      await shell.openExternal(url);
    },
    'window.minimize': (_input, event) => BrowserWindow.fromWebContents(event.sender)?.minimize(),
    'window.toggleMaximize': (_input, event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return;
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    },
    'window.close': (_input, event) => BrowserWindow.fromWebContents(event.sender)?.close(),
    'window.isMaximized': (_input, event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false,
    'settings.get': () => settings.getAppSettings(),
    'settings.set': (patch) => {
      const updated = settings.updateAppSettings(patch);
      broadcast('settings.changed', updated);
      if (patch.updateIntervalHours !== undefined) updates.reschedule();
      if (patch.closeToTray !== undefined || patch.runAtLogin !== undefined) applySystemSettings(updated);
      if (NETWORK_SETTING_KEYS.some((key) => patch[key] !== undefined))
        void networkApplier.apply().catch(() => undefined);
      return updated;
    },
    'dialog.pickFolder': async (_input, event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = { properties: ['openDirectory' as const] };
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    'network.getStatus': () => ({ online: network.status.isOnline }),
    'network.testConnection': (input) => networkApplier.test(input),
    'network.proxyPasswordInfo': () => proxyPassword.info(),
    'network.setProxyPassword': async ({ password }) => {
      const info = proxyPassword.set(password);
      await networkApplier.apply();
      return info;
    },
    'incognito.get': () => incognito.enabled,
    'incognito.set': (on) => incognito.set(on),
    'backup.export': async (_input, event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = {
        defaultPath: backup.defaultFileName(),
        filters: [{ name: 'Matane Anime backup', extensions: ['zip'] }],
      };
      const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;
      await backup.exportTo(result.filePath);
      return { path: result.filePath };
    },
    'backup.peek': async (_input, event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = {
        properties: ['openFile' as const],
        filters: [{ name: 'Matane Anime backup', extensions: ['zip'] }],
      };
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      const file = result.canceled ? undefined : result.filePaths[0];
      return file ? backup.peek(file) : null;
    },
    'backup.import': ({ token }) => backup.import(token),
    'app.changelog': notYet('The changelog'),
    'requests.cancel': (requestId) => requests.cancel(requestId),
    'extensions.list': () => registry.list(),
    'extensions.loadDevFolder': ({ folder }) => registry.loadFolder(folder),
    'extensions.removeDevFolder': ({ folder }) => registry.removeFolder(folder),
    'extensions.reload': ({ folder }) => registry.loadFolder(folder),
    'extensions.logs': ({ extensionId }) => logs.list(extensionId),
    'extensions.preferences': ({ extensionId }) => service.preferences(extensionId),
    'extensions.setPreference': ({ extensionId, key, value }) => service.setPreference(extensionId, key, value),
    'extensions.available': () => repos.available(),
    'extensions.prepareInstall': (input) => installs.prepareInstall(input),
    'extensions.install': ({ token }) => installs.install(token),
    'extensions.update': ({ extensionId }) => installs.update(extensionId),
    'extensions.updateAll': () => installs.updateAll(),
    'extensions.uninstall': ({ extensionId }) => installs.uninstall(extensionId),
    'repos.list': () => repos.list(),
    'repos.preview': ({ url }) => repos.preview(url),
    'repos.add': ({ url, trustKey }) => repos.add(url, trustKey),
    'repos.remove': ({ id }) => repos.remove(id),
    'repos.refresh': ({ id }) => repos.refresh(id),
    'repos.setTrust': ({ id, trusted }) => repos.setTrust(id, trusted),
    'sources.list': () => service.listSources(),
    'sources.capabilities': ({ sourceId }) => service.capabilities(sourceId),
    'sources.filters': ({ sourceId, requestId }) => service.filters(sourceId, requestId),
    'sources.browse': (input) => service.browse(input),
    'sources.resolveUrl': ({ sourceId, url }) => service.resolveUrl(sourceId, url),
    'sources.setPinned': ({ sourceId, pinned }) => service.setPinned(sourceId, pinned),
    'anime.get': ({ animeId }) => service.getAnime(animeId),
    'anime.refresh': ({ animeId, requestId }) => service.refresh(animeId, requestId),
    'episodes.list': ({ animeId }) => service.listEpisodes(animeId),
    'library.list': (query) => library.list(query),
    'library.count': () => library.count(),
    'library.markWatched': ({ animeIds, watched }) => watch.markAnimeWatched(animeIds, watched),
    'library.add': ({ animeId, categoryIds }) => library.add(animeId, categoryIds),
    'library.remove': ({ animeId }) => library.remove(animeId),
    'library.setCategories': ({ animeIds, categoryIds }) => libraryRepo.setCategories(animeIds, categoryIds),
    'library.migratePreview': ({ fromAnimeId, toAnimeId, requestId }) =>
      migration.preview(fromAnimeId, toAnimeId, requestId),
    'library.migrate': ({ fromAnimeId, toAnimeId }) => migration.migrate(fromAnimeId, toAnimeId),
    'categories.list': () => libraryRepo.listCategories(),
    'categories.create': ({ name }) => libraryRepo.createCategory(name),
    'categories.rename': ({ id, name }) => libraryRepo.renameCategory(id, name),
    'categories.delete': ({ id }) => libraryRepo.deleteCategory(id),
    'categories.reorder': ({ ids }) => libraryRepo.reorderCategories(ids),
    'categories.setAutoDownload': ({ id, mode }) => libraryRepo.setCategoryAutoDownload(id, mode),
    'episodes.markWatched': ({ episodeIds, watched }) => watch.markWatched(episodeIds, watched),
    'episodes.markPrevious': ({ episodeId }) => watch.markPrevious(episodeId),
    'episodes.resetProgress': ({ episodeId }) => watch.resetProgress(episodeId),
    'watch.progress': (input) => watch.progress(input),
    'watch.continueTarget': ({ animeId }) => watch.continueTarget(animeId),
    'history.list': () => watch.listHistory(),
    'history.delete': ({ animeId }) => watch.deleteHistory(animeId),
    'history.clear': () => watch.clearHistory(),
    'playback.start': ({ episodeId, requestId }) => playback.start(episodeId, requestId),
    'playback.event': ({ playbackId, event }) => playback.event(playbackId, event),
    'playback.switchStream': ({ playbackId, index, requestId }) => playback.switchStream(playbackId, index, requestId),
    'playback.close': ({ playbackId }) => playback.close(playbackId),
    'playback.keepAwake': ({ enabled }) => playback.keepAwake(enabled),
    'downloads.list': () => downloads.list(),
    'downloads.enqueue': (input) => downloads.enqueue(input, { reason: 'manual' }),
    'downloads.pause': ({ id }) => downloads.pause(id),
    'downloads.resume': ({ id }) => downloads.resume(id),
    'downloads.pauseAll': () => downloads.pauseAll(),
    'downloads.resumeAll': () => downloads.resumeAll(),
    'downloads.cancel': ({ id }) => downloads.cancel(id),
    'downloads.remove': ({ id }) => downloads.remove(id),
    'downloads.retry': ({ id }) => downloads.retry(id),
    'downloads.reorder': ({ ids }) => downloads.reorder(ids),
    'downloads.clearFailed': () => downloads.clearFailed(),
    'downloads.storage': () => downloads.storage(),
    'downloads.changeFolder': ({ folder, move }) => downloads.changeFolder(folder, move),
    'downloads.openFolder': async () => {
      const { folder } = await downloads.storage();
      // Nothing is downloaded before the first episode, so the folder may not exist yet.
      await mkdir(folder, { recursive: true });
      const failure = await shell.openPath(folder);
      if (failure) throw new AppError('internal', failure);
    },
    'updates.list': () => updates.list(),
    'updates.count': () => updates.count(),
    'updates.check': ({ scope, requestId }) => updates.check(scope, requestId),
    'dev.seedLibrary': ({ anime, episodesPerAnime }) => {
      requireSpike();
      seedLibrary(anime, episodesPerAnime);
    },
    'spike.fixtures': () => requireSpike().fixtures(),
    'spike.start': ({ id }) => requireSpike().start(id),
    'spike.stats': () => requireSpike().stats(),
    'spike.reset': () => requireSpike().reset(),
    'spike.report': (result) => requireSpike().report(result),
  };
}
