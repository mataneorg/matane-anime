import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, app, crashReporter } from 'electron';
import { createMainWindow } from './app/window';
import { initLogging } from './app/log';
import { openDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { HostError } from '@matane-anime/extension-runtime/client';
import { AnimeRepository } from './db/repositories/anime';
import { ChangeEmitter } from './db/repositories/changes';
import { EpisodesRepository } from './db/repositories/episodes';
import { ExtensionStore } from './db/repositories/extension-store';
import { SettingsRepository } from './db/repositories/settings';
import { ExtensionHostClient } from './extensions/host-client';
import { ExtensionLogs } from './extensions/logs';
import { ExtensionRegistry } from './extensions/registry';
import { ExtensionService } from './extensions/service';
import { createHandlers } from './ipc/handlers';
import { broadcast, registerIpcHandlers } from './ipc/register';
import { RequestRegistry } from './ipc/requests';
import { NetworkManager } from './network/manager';
import { SessionStore } from './playback/sessions';
import { handleAnimeScheme, registerAnimeScheme } from './playback/scheme';
import { SpikeApi } from './playback/spike/api';
import { selectUpstream } from './playback/upstream';

import { API_VERSION } from '@matane-anime/extension-sdk/manifest';

const log = initLogging();

app.setName('Matane Anime');
// Dumps stay on this machine: no telemetry (docs/PRD.md §10.3).
crashReporter.start({ uploadToServer: false });
// Before `ready`: the `anime://` scheme has to be privileged ahead of time.
registerAnimeScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  void app
    .whenReady()
    .then(async () => {
      const userData = app.getPath('userData');
      mkdirSync(userData, { recursive: true });

      const connection = openDatabase(join(userData, 'data.db'));
      const migration = await runMigrations(connection, {
        migrationsFolder: join(app.getAppPath(), 'drizzle'),
        backupDir: join(userData, 'backups', 'db'),
      });
      log.info(`database ready (${migration.applied} migration(s) applied, backup: ${migration.backupPath ?? 'none'})`);
      const settings = new SettingsRepository(connection.db);

      // Extensions: the host process runs their sandboxes; everything they touch goes through main.
      const changes = new ChangeEmitter();
      changes.subscribe((change) => broadcast('db.changed', change));
      const store = new ExtensionStore(connection.db, changes);
      const animeRepo = new AnimeRepository(connection.db, changes);
      const episodeRepo = new EpisodesRepository(connection.db, changes);
      const logs = new ExtensionLogs();
      logs.subscribe((entry) => broadcast('extensions.log', entry));
      const requests = new RequestRegistry();
      const network = new NetworkManager(settings, {
        onCloudflare: (status) => broadcast('cloudflare.status', status),
        onOnline: (online) => broadcast('network.status', { online }),
      });
      network.status.start();

      // eslint-disable-next-line prefer-const -- the host's callbacks need the registry, which needs the host
      let registry: ExtensionRegistry;
      const host = new ExtensionHostClient(
        join(__dirname, 'extension-host.js'),
        {
          http: (extensionId, request) => {
            const manifest = registry.byExtensionId(extensionId)?.manifest;
            if (!manifest) throw new HostError('ExtensionError', `${extensionId} is not loaded`);
            return network
              .fetcherFor({ id: manifest.id, userAgent: manifest.userAgent, rateLimit: manifest.rateLimit })
              .request(request);
          },
          storage: {
            get: (extensionId, key) => store.storageGet(extensionId, key),
            set: (extensionId, key, value) => store.storageSet(extensionId, key, value),
            remove: (extensionId, key) => store.storageRemove(extensionId, key),
          },
          log: (extensionId, level, message) => logs.push({ extensionId, level, message, at: Date.now() }),
        },
        () => registry.hostExited(),
      );
      registry = new ExtensionRegistry({
        host,
        store,
        settings,
        hostInfo: { appName: app.getName(), appVersion: app.getVersion(), apiVersion: API_VERSION },
        onReloaded: (extensionId) => network.invalidate(extensionId),
        onChanged: () => changes.emit('extensions', 'sources'),
      });
      const service = new ExtensionService({
        registry,
        host,
        store,
        anime: animeRepo,
        episodes: episodeRepo,
        network,
        requests,
      });
      void registry.init();

      const sessions = new SessionStore();
      const fetchUpstream = selectUpstream();
      handleAnimeScheme({
        sessions,
        fetchUpstream,
        fetcherFor: (sourceId) => {
          const manifest = registry.byExtensionId(sourceId.split('/')[0] ?? '')?.manifest;
          return manifest
            ? network.fetcherFor({ id: manifest.id, userAgent: manifest.userAgent, rateLimit: manifest.rateLimit })
            : undefined;
        },
        onRequest: (entry) => {
          const message = `anime:// ${entry.status} ${entry.target}${entry.range ? ` [${entry.range}]` : ''}`;
          if (entry.error) log.warn(`${message}: ${entry.error}`);
          else log.debug(message);
        },
      });

      const spikeEnabled = process.env['MATANE_SPIKE'] === '1' || !app.isPackaged;
      const spike = spikeEnabled
        ? await SpikeApi.create({
            fixturesDir: join(app.getAppPath(), 'e2e/fixtures/media'),
            outFile: process.env['MATANE_SPIKE_OUT'] ?? join(userData, 'spike-results.json'),
            sessions,
            environment: {
              platform: process.platform,
              arch: process.arch,
              electron: process.versions.electron,
              chrome: process.versions.chrome,
              node: process.versions.node,
              upstream: process.env['MATANE_SPIKE_FETCH'] === 'request' ? 'net.request' : 'net.fetch',
            },
          })
        : null;

      registerIpcHandlers(createHandlers({ settings, registry, service, logs, network, requests, spike }));
      createMainWindow(settings);

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow(settings);
      });
      // `quit`, not `before-quit`: windows still save their geometry while they close.
      app.on('quit', () => {
        registry.dispose();
        network.status.stop();
        host.kill();
        void spike?.close();
        connection.sqlite.close();
      });
    })
    .catch((error: unknown) => {
      // Without this a failed start is a silent process with no window.
      log.error('startup failed', error);
      app.exit(1);
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
