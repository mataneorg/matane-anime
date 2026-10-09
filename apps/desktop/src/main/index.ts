import { existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, app, crashReporter, safeStorage, session } from 'electron';
import type { AppSettings } from '@matane-anime/shared';
import { autoUpdater } from 'electron-updater';
import { createMainWindow } from './app/window';
import { BackupService } from './backup/service';
import { applyPendingRestore } from './backup/restore';
import { markExistingProfileOnboarded } from './app/onboarding';
import { applyRunAtLogin } from './app/autostart';
import { SystemIntegration, trayText } from './app/system';
import { createElectronTray } from './app/tray';
import { printSmokeReport, isSmokeRun, runSmoke } from './app/smoke';
import { AppUpdater, type AutoUpdaterLike } from './app/updater';
import { initLogging } from './app/log';
import { openDatabase } from './db/client';
import { purgeBrowseRows } from './db/housekeeping';
import { seedLibrary } from './db/seed';
import { countBundledMigrations, runMigrations } from './db/migrate';
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
import { WatchDownloads } from './downloads/watch-hooks';
import { LibraryCovers } from './library/covers';
import { MigrationService } from './library/migration';
import { LibraryService } from './library/service';
import { UpdatesRepository } from './db/repositories/updates';
import { resolveLanguage } from './updates/messages';
import { isWindowFocused, showUpdateNotification } from './updates/notify';
import { UpdateService } from './updates/service';
import { IncognitoState } from './watch/incognito';
import { WatchService } from './watch/service';
import { RepoStore } from './db/repositories/extension-repos';
import { ExtensionStore } from './db/repositories/extension-store';
import { SettingsRepository } from './db/repositories/settings';
import { ExtensionHostClient } from './extensions/host-client';
import { InstallService } from './extensions/install';
import { ExtensionLogs } from './extensions/logs';
import { ExtensionRegistry } from './extensions/registry';
import { RepoService } from './extensions/repos';
import { ExtensionService } from './extensions/service';
import { createHandlers } from './ipc/handlers';
import { broadcast, registerIpcHandlers } from './ipc/register';
import { RequestRegistry } from './ipc/requests';
import { NetworkApplier } from './network/apply';
import { NetworkManager } from './network/manager';
import { ProxyPasswordStore } from './network/proxy-password';
import { RepoFetcher } from './network/repo-fetcher';
import { defaultUserAgent } from './network/user-agent';
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

// Set once the tray exists: `window-all-closed` quits unless the tray keeps the app running (UPD-9).
let keepsRunning = (): boolean => false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    // Launching again is how a user reaches an app hidden behind a tray that does not show (Linux, R14).
    if (!window.isVisible()) window.show();
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  void app
    .whenReady()
    .then(async () => {
      const userData = app.getPath('userData');
      mkdirSync(userData, { recursive: true });

      const migrationsFolder = join(app.getAppPath(), 'drizzle');
      // A restore chosen in the last run is applied before the database opens (it is never swapped under a live handle).
      const restored = applyPendingRestore({
        userData,
        bundledMigrations: countBundledMigrations(migrationsFolder),
        now: new Date(),
        folderExists: existsSync,
      });
      if (restored.status === 'applied')
        log.info(`backup restored (previous data kept at ${restored.safetyCopy ?? 'nowhere'})`);
      else if (restored.status === 'failed') log.error(`backup could not be restored: ${restored.error}`);

      const connection = openDatabase(join(userData, 'data.db'));
      const migration = await runMigrations(connection, {
        migrationsFolder,
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
      const proxyPassword = new ProxyPasswordStore(settings, safeStorage);
      const networkApplier = new NetworkApplier(settings, proxyPassword);
      const network = new NetworkManager(settings, {
        onSession: (extensionSession) => networkApplier.track(extensionSession),
        onCloudflare: (status) => broadcast('cloudflare.status', status),
        onOnline: (online) => broadcast('network.status', { online }),
      });
      network.status.start();
      // The proxy, DNS over HTTPS and the old User-Agent row (before the first request goes out).
      networkApplier.start();

      // Extension repositories (EXT-5…9): fetched by their own session, never by an extension's fetcher.
      const repoSession = session.fromPartition('persist:repos');
      const repoHttp = new RepoFetcher({
        session: repoSession,
        userAgent: () => networkApplier.userAgent() ?? defaultUserAgent(repoSession),
        isOnline: () => network.status.isOnline,
      });
      const repoService = new RepoService({
        http: repoHttp,
        repos: new RepoStore(connection.db, changes),
        extensions: store,
        settings,
        appVersion: app.getVersion(),
        isDevLoaded: (extensionId) => registry.isDevLoaded(extensionId),
        log: { warn: (message, error) => log.warn(message, error) },
      });

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
        repos: repoService,
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
      // A profile from before the first-run flow existed does not get it (UI-9).
      markExistingProfileOnboarded(
        settings,
        () =>
          libraryRepo.count() > 0 ||
          (connection.sqlite.prepare('SELECT COUNT(*) AS n FROM history').get() as { n: number }).n > 0,
      );
      const covers = new LibraryCovers(
        join(userData, 'covers'),
        animeRepo,
        (sourceId) => fetcherFor(sourceId.split('/')[0] ?? ''),
        (message, error) => log.warn(message, error),
      );
      const libraryService = new LibraryService({ library: libraryRepo, history: historyRepo, settings, covers });
      const incognito = new IncognitoState();
      incognito.subscribe((on) => broadcast('incognito.changed', on));
      const watch = new WatchService({
        episodes: episodeRepo,
        anime: animeRepo,
        history: historyRepo,
        sessions: new WatchSessionsRepository(connection.db),
        settings,
        changes,
        isIncognito: () => incognito.enabled,
      });
      const service = new ExtensionService({
        registry,
        host,
        store,
        settings,
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
        beforeScheduledCheck: async () => {
          if (network.status.isOnline) await repoService.refresh();
        },
      });
      const extensionsDir = join(userData, 'extensions');
      mkdirSync(extensionsDir, { recursive: true });
      const installService = new InstallService({
        http: repoHttp,
        repos: repoService,
        store,
        registry,
        extensionsDir,
        migrate: (extensionId) => updateService.migrateExtension(extensionId),
        clearSession: async (extensionId) => {
          const target = session.fromPartition(`persist:ext-${extensionId}`);
          await target.clearStorageData();
          await target.clearCache();
          await target.clearAuthCache();
        },
        invalidateNetwork: (extensionId) => network.invalidate(extensionId),
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
      const registryReady = installService
        .recoverInterrupted()
        .catch((error: unknown) => log.warn('could not recover an interrupted install', error))
        .then(() => registry.init())
        .catch((error: unknown) => log.error('extension registry failed to start', error));
      void registryReady.then(() => updateService.start());
      // Look at the repositories once at start, without holding anything up (needs the network).
      void registryReady.then(() => {
        if (network.status.isOnline) {
          void repoService.refresh().catch((error: unknown) => log.warn('repository refresh failed', error));
        }
      });

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
      // Download ahead and delete after watched follow what WatchService reports (DL-12, DL-13).
      new WatchDownloads({
        settings,
        episodes: episodeRepo,
        anime: animeRepo,
        downloads: downloadsRepo,
        categoryIdsOf: (animeId) => libraryRepo.categoryIdsOf(animeId),
        enqueueAhead: (episodeIds) => downloadService.enqueue({ episodeIds }, { reason: 'ahead' }),
        removeDownload: (id) => downloadService.remove(id),
        log: (message, error) => log.warn(message, error),
      }).attach(watch);

      const openMainWindow = (): void => {
        const [window] = BrowserWindow.getAllWindows();
        if (!window) {
          createMainWindow(settings, { shouldHideOnClose: () => system.shouldHideOnClose() });
          return;
        }
        if (!window.isVisible()) window.show();
        if (window.isMinimized()) window.restore();
        window.focus();
      };
      const system: SystemIntegration = new SystemIntegration({
        createTray: createElectronTray,
        open: openMainWindow,
        checkUpdates: () => updateService.check({ kind: 'all' }),
        quit: () => app.quit(),
        downloads: {
          isPaused: () => {
            const counts = downloadsRepo.counts();
            return counts.paused > 0 && counts.downloading + counts.queued === 0;
          },
          pauseAll: () => downloadService.pauseAll(),
          resumeAll: () => downloadService.resumeAll(),
        },
        text: () => trayText(resolveLanguage(settings.getAppSettings().language, app.getLocale())),
        log: { warn: (message, error) => log.warn(message, error) },
      });
      keepsRunning = () => system.keepsRunning();
      changes.subscribe(({ tags }) => {
        if (tags.includes('downloads')) system.refresh();
      });
      // The tray and the login item follow `closeToTray` and `runAtLogin`, at startup and when they change.
      const applySystemSettings = (current: AppSettings): void => {
        system.apply(current.closeToTray);
        // Not for a development run: it would register the bare Electron binary.
        if (!app.isPackaged) return;
        try {
          applyRunAtLogin(current.runAtLogin, {
            platform: process.platform,
            setLoginItemSettings: (login) => app.setLoginItemSettings(login),
            linux: {
              dir: join(process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'autostart'),
              execPath: process.execPath,
              appImage: process.env['APPIMAGE'],
            },
          });
        } catch (error) {
          log.warn('could not update the start-at-login entry', error);
        }
      };
      applySystemSettings(settings.getAppSettings());
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
          repos: repoService,
          installs: installService,
          logs,
          network,
          networkApplier,
          proxyPassword,
          requests,
          playback,
          watch,
          incognito,
          library: libraryService,
          downloads: downloadService,
          updates: updateService,
          libraryRepo,
          migration: sourceMigration,
          backup: new BackupService({
            sqlite: connection.sqlite,
            userData,
            appVersion: app.getVersion(),
            bundledMigrations: countBundledMigrations(migrationsFolder),
            // After the answer reached the window; `quit` closes the database and saves the window first.
            restart: () =>
              setTimeout(() => {
                app.relaunch();
                app.quit();
              }, 800),
          }),
          applySystemSettings,
          seedLibrary: (anime, episodesPerAnime) => {
            seedLibrary(connection.sqlite, anime, episodesPerAnime);
            changes.emit('library', 'categories');
          },
          spike,
        }),
      );
      const mainWindow = createMainWindow(settings, {
        startHidden: system.shouldStartHidden(process.argv),
        shouldHideOnClose: () => system.shouldHideOnClose(),
      });

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
        if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
      });
      app.on('before-quit', () => system.markQuitting());
      // `quit`, not `before-quit`: windows still save their geometry while they close.
      app.on('quit', () => {
        system.dispose();
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
    if (process.platform !== 'darwin' && !keepsRunning()) app.quit();
  });
}
