import { AppError } from '@matane-anime/shared';
import { BrowserWindow, app } from 'electron';
import type { SettingsRepository } from '../db/repositories/settings';
import type { SpikeApi } from '../playback/spike/api';
import { type IpcHandlers, broadcast } from './register';

export interface HandlerDeps {
  settings: SettingsRepository;
  /** Null unless the spike is switched on (development, or MATANE_SPIKE=1). */
  spike: SpikeApi | null;
}

export function createHandlers({ settings, spike }: HandlerDeps): IpcHandlers {
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
    'spike.fixtures': () => requireSpike().fixtures(),
    'spike.start': ({ id }) => requireSpike().start(id),
    'spike.stats': () => requireSpike().stats(),
    'spike.reset': () => requireSpike().reset(),
    'spike.report': (result) => requireSpike().report(result),
  };
}
