import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserWindow, app, crashReporter } from 'electron';
import { autoUpdater } from 'electron-updater';
import { createMainWindow } from './app/window';
import { printSmokeReport, isSmokeRun, runSmoke } from './app/smoke';
import { AppUpdater, type AutoUpdaterLike } from './app/updater';
import { initLogging } from './app/log';
import { openDatabase } from './db/client';
import { purgeBrowseRows } from './db/housekeeping';
import { seedLibrary } from './db/seed';
import { runMigrations } from './db/migrate';
import { HostError } from '@matane-anime/extension-runtime/client';
import { AnimeRepository } from './db/repositories/anime';
import { ChangeEmitter } from './db/repositories/changes';
import { DownloadsRepository } from './db/repositories/downloads';
import { EpisodesRepository } from './db/repositories/episodes';
import { HistoryRepository } from './db/repositories/history';
import { LibraryRepository } from './db/repositories/library';
import { WatchSessionsRepository } from './db/repositories/watch-sessions';
import { createDownloadUpstream, createStreamSource } from './downloads/adapters';
import { DownloadService } from './downloads/service';
import { LibraryCovers } from './library/covers';
import { MigrationService } from './library/migration';
import { LibraryService } from './library/service';
import { UpdatesRepository } from './db/repositories/updates';
import { isWindowFocused, showUpdateNotification } from './updates/notify';
import { UpdateService } from './updates/service';
import { WatchService } from './watch/service';
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
import { PlaybackService } from './playback/service';
import { SessionStore } from './playback/sessions';
import { handleAnimeScheme, registerAnimeScheme } from './playback/scheme';
import { SpikeApi } from './playback/spike/api';
import { createSessionUpstream } from './playback/upstream';

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
      // Rows that only exist because a listing showed them are cache: drop the old ones (docs/adr/0016).
      const purged = purgeBrowseRows(connection.sqlite, Date.now());
      if (purged.deleted > 0) log.info(`removed ${purged.deleted} browse-only anime rows older than 14 days`);
      for (const path of purged.coverPaths) void rm(path, { force: true });

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
      const fetcherFor = (extensionId: string) => {
        const manifest = registry.byExtensionId(extensionId)?.manifest;
        return manifest
          ? network.fetcherFor({ id: manifest.id, userAgent: manifest.userAgent, rateLimit: manifest.rateLimit })
          : undefined;
      };
      const downloadsRepo = new DownloadsRepository(connection.db, changes);
      const historyRepo = new HistoryRepository(connection.db, changes);
      const libraryRepo = new LibraryRepository(connection.db, changes);
      const covers = new LibraryCovers(
        join(userData, 'covers'),
        animeRepo,
        (sourceId) => fetcherFor(sourceId.split('/')[0] ?? ''),
        (message, error) => log.warn(message, error),
      );
      const libraryService = new LibraryService({ library: libraryRepo, history: historyRepo, settings, covers });
      const watch = new WatchService({
        episodes: episodeRepo,
        anime: animeRepo,
        history: historyRepo,
        sessions: new WatchSessionsRepository(connection.db),
        settings,
        changes,
      });
      const service = new ExtensionService({
        registry,
        host,
        store,
        anime: animeRepo,
        episodes: episodeRepo,
        network,
        requests,
        categoryIdsOf: (animeId) => libraryRepo.categoryIdsOf(animeId),
        // A library entry's permanent cover follows the site's image when it changes (LIB-7).
        onRefreshed: (row, previousThumbnail) => {
          if (row.inLibrary && row.thumbnailUrl !== previousThumbnail) void covers.ensure(row.id, true);
        },
      });
      const updateService = new UpdateService({
        repo: new UpdatesRepository(connection.db, changes),
        settings,
        extensions: service,
        requests,
        emitStatus: (status) => broadcast('updates.status', status),
        autoDownload: async (episodeIds) => {
          if (episodeIds.length > 0) await downloadService.enqueue({ episodeIds }, { reason: 'auto' });
        },
        notify: showUpdateNotification,
        navigate: () => {
          const [window] = BrowserWindow.getAllWindows();
          if (window?.isMinimized()) window.restore();
          window?.focus();
          broadcast('app.navigate', { to: '/updates' });
        },
        isWindowFocused,
        systemLocale: () => app.getLocale(),
        isOnline: () => network.status.isOnline,
        onOnlineChange: (listener) => network.onOnlineChange(listener),
        log: { warn: (message, error) => log.warn(message, error) },
      });
      const sourceMigration = new MigrationService({
        anime: animeRepo,
        episodes: episodeRepo,
        library: libraryRepo,
        refresh: (animeId, requestId) => service.refresh(animeId, requestId),
        afterMigrate: (fromId, toId) => {
          void covers.ensure(toId);
          void covers.remove(fromId);
        },
      });
      // The schedule starts once the extensions are loaded: a check before that would fail every anime.
      const registryReady = registry
        .init()
        .catch((error: unknown) => log.error('extension registry failed to start', error));
      void registryReady.then(() => updateService.start());

      const sessions = new SessionStore();
      const fetchUpstream = createSessionUpstream(fetcherFor);
      const downloadService = new DownloadService({
        downloads: downloadsRepo,
        episodes: episodeRepo,
        anime: animeRepo,
        settings,
        sourceName: (sourceId) => store.getSource(sourceId)?.name ?? null,
        assertAvailable: (sourceId) => service.assertAvailable(sourceId),
        streamsFor: createStreamSource({ episodes: episodeRepo, anime: animeRepo, settings, extensions: service }),
        upstream: createDownloadUpstream(fetchUpstream),
        defaultFolder: () => join(app.getPath('documents'), 'Matane Anime'),
        isOnline: () => network.status.isOnline,
        onOnlineChange: (listener) => network.onOnlineChange(listener),
        emitProgress: (items) => broadcast('downloads.progress', items),
        ready: registryReady,
        log: (message, error) => log.warn(message, error),
      });
      downloadService.start();
      handleAnimeScheme({
        sessions,
        fetchUpstream,
        fetcherFor: (sourceId) => fetcherFor(sourceId.split('/')[0] ?? ''),
        localCover: (animeId) => covers.localCover(animeId),
        onRequest: (entry) => {
          const message = `anime:// ${entry.status} ${entry.target}${entry.range ? ` [${entry.range}]` : ''}`;
          if (entry.error) log.warn(`${message}: ${entry.error}`);
          else log.debug(message);
        },
      });
      const playback = new PlaybackService({
        extensions: service,
        anime: animeRepo,
        episodes: episodeRepo,
        settings,
        store,
        sessions,
        downloads: downloadsRepo,
        upstream: fetchUpstream,
        requests,
        resumeFor: (episode) => watch.resumeFor(episode),
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

      registerIpcHandlers(
        createHandlers({
          settings,
          registry,
          service,
          logs,
          network,
          requests,
          playback,
          watch,
          library: libraryService,
          downloads: downloadService,
          updates: updateService,
          libraryRepo,
          migration: sourceMigration,
          seedLibrary: (anime, episodesPerAnime) => {
            seedLibrary(connection.sqlite, anime, episodesPerAnime);
            changes.emit('library', 'categories');
          },
          spike,
        }),
      );
      const mainWindow = createMainWindow(settings);

      const updater = new AppUpdater({
        app,
        getAutoUpdater: () => autoUpdater as unknown as AutoUpdaterLike,
        getChannel: () => settings.getAppSettings().updateChannel,
        logger: log,
      });
      app.on('quit', () => updater.stop());
      if (isSmokeRun()) {
        // scripts/smoke-packaged.mjs: check the packaged pieces, report, quit. No update check, no network.
        void runSmoke({ app, sqlite: connection.sqlite, host, window: mainWindow }).then((report) => {
          printSmokeReport(report);
          if (report.ok) app.quit();
          else app.exit(1);
        });
      } else {
        updater.start();
      }

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow(settings);
      });
      // `quit`, not `before-quit`: windows still save their geometry while they close.
      app.on('quit', () => {
        downloadService.shutdown();
        updateService.stop();
        playback.closeAll();
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
