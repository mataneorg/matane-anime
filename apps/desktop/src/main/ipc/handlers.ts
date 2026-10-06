import { AppError } from '@matane-anime/shared';
import { BrowserWindow, app, dialog } from 'electron';
import type { SettingsRepository } from '../db/repositories/settings';
import type { ExtensionLogs } from '../extensions/logs';
import type { ExtensionRegistry } from '../extensions/registry';
import type { ExtensionService } from '../extensions/service';
import type { NetworkManager } from '../network/manager';
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
    'spike.fixtures': () => requireSpike().fixtures(),
    'spike.start': ({ id }) => requireSpike().start(id),
    'spike.stats': () => requireSpike().stats(),
    'spike.reset': () => requireSpike().reset(),
    'spike.report': (result) => requireSpike().report(result),
  };
}
