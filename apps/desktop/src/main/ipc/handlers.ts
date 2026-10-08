import { AppError } from '@matane-anime/shared';
import { BrowserWindow, app, dialog, shell } from 'electron';
import type { SettingsRepository } from '../db/repositories/settings';
import type { ExtensionLogs } from '../extensions/logs';
import type { ExtensionRegistry } from '../extensions/registry';
import type { ExtensionService } from '../extensions/service';
import type { NetworkManager } from '../network/manager';
import type { LibraryRepository } from '../db/repositories/library';
import type { LibraryService } from '../library/service';
import type { PlaybackService } from '../playback/service';
import type { WatchService } from '../watch/service';
import type { SpikeApi } from '../playback/spike/api';
import { type IpcHandlers, broadcast } from './register';
import type { RequestRegistry } from './requests';

export interface HandlerDeps {
  settings: SettingsRepository;
  registry: ExtensionRegistry;
  service: ExtensionService;
  logs: ExtensionLogs;
  network: NetworkManager;
  requests: RequestRegistry;
  playback: PlaybackService;
  watch: WatchService;
  library: LibraryService;
  libraryRepo: LibraryRepository;
  /** Null unless the spike is switched on (development, or MATANE_SPIKE=1). */
  spike: SpikeApi | null;
}

export function createHandlers({
  settings,
  registry,
  service,
  logs,
  network,
  requests,
  playback,
  watch,
  library,
  libraryRepo,
  spike,
}: HandlerDeps): IpcHandlers {
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
      return updated;
    },
    'dialog.pickFolder': async (_input, event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = { properties: ['openDirectory' as const] };
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    'network.getStatus': () => ({ online: network.status.isOnline }),
    'requests.cancel': (requestId) => requests.cancel(requestId),
    'extensions.list': () => registry.list(),
    'extensions.loadDevFolder': ({ folder }) => registry.loadFolder(folder),
    'extensions.removeDevFolder': ({ folder }) => registry.removeFolder(folder),
    'extensions.reload': ({ folder }) => registry.loadFolder(folder),
    'extensions.logs': ({ extensionId }) => logs.list(extensionId),
    'extensions.preferences': ({ extensionId }) => service.preferences(extensionId),
    'extensions.setPreference': ({ extensionId, key, value }) => service.setPreference(extensionId, key, value),
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
    'library.add': ({ animeId, categoryIds }) => library.add(animeId, categoryIds),
    'library.remove': ({ animeId }) => library.remove(animeId),
    'library.setCategories': ({ animeIds, categoryIds }) => libraryRepo.setCategories(animeIds, categoryIds),
    'categories.list': () => libraryRepo.listCategories(),
    'categories.create': ({ name }) => libraryRepo.createCategory(name),
    'categories.rename': ({ id, name }) => libraryRepo.renameCategory(id, name),
    'categories.delete': ({ id }) => libraryRepo.deleteCategory(id),
    'categories.reorder': ({ ids }) => libraryRepo.reorderCategories(ids),
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
    'spike.fixtures': () => requireSpike().fixtures(),
    'spike.start': ({ id }) => requireSpike().start(id),
    'spike.stats': () => requireSpike().stats(),
    'spike.reset': () => requireSpike().reset(),
    'spike.report': (result) => requireSpike().report(result),
  };
}
