import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, app, crashReporter } from 'electron';
import { createMainWindow } from './app/window';
import { initLogging } from './app/log';
import { openDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { SettingsRepository } from './db/repositories/settings';
import { createHandlers } from './ipc/handlers';
import { registerIpcHandlers } from './ipc/register';
import { SessionStore } from './playback/sessions';
import { handleAnimeScheme, registerAnimeScheme } from './playback/scheme';
import { SpikeApi } from './playback/spike/api';
import { selectUpstream } from './playback/upstream';

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

      const sessions = new SessionStore();
      const fetchUpstream = selectUpstream();
      handleAnimeScheme({
        sessions,
        fetchUpstream,
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

      registerIpcHandlers(createHandlers({ settings, spike }));
      createMainWindow(settings);

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow(settings);
      });
      // `quit`, not `before-quit`: windows still save their geometry while they close.
      app.on('quit', () => {
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
