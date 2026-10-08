import type { BrowserWindow } from 'electron';
import { API_VERSION } from '@matane-anime/extension-sdk/manifest';
import type { ExtensionHostClient } from '../extensions/host-client';

// Packaged-app smoke test (scripts/smoke-packaged.mjs). With MATANE_SMOKE=1 the app checks that the pieces
// that only break after packaging work (native SQLite, migrations from `drizzle/`, the extension host with
// its QuickJS WASM, the renderer bundle), prints one `MATANE_SMOKE {json}` line and quits. Nothing sets
// the variable for a normal user, and no other code path looks at it.

export const SMOKE_PREFIX = 'MATANE_SMOKE ';

export function isSmokeRun(env: Record<string, string | undefined> = process.env): boolean {
  return env['MATANE_SMOKE'] === '1';
}

export interface SmokeReport {
  ok: boolean;
  version: string;
  packaged: boolean;
  userData: string;
  sqliteVersion?: string;
  migrations?: number;
  tables?: number;
  host?: { answer: unknown; loadedAfterStatus: number };
  renderer?: { rootChildren: number; title: string };
  errors: string[];
}

export interface SmokeDeps {
  app: { getVersion(): string; isPackaged: boolean; getPath(name: 'userData'): string };
  sqlite: { prepare(sql: string): { get(): unknown } };
  host: Pick<ExtensionHostClient, 'send'>;
  window: Pick<BrowserWindow, 'webContents'>;
  timeoutMs?: number;
}

const MANIFEST = {
  id: 'smoke',
  name: 'Smoke',
  version: '0.0.0',
  apiVersion: API_VERSION,
  type: 'anime' as const,
  nsfw: false,
  sources: [{ key: 'main', lang: 'en', name: 'Smoke' }],
};
// The smallest bundle the runtime accepts: it only has to prove that QuickJS starts and answers.
const CODE = "globalThis.__extension = { createSource() { return { ping() { return 'pong'; } }; } };";

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function step(report: SmokeReport, name: string, run: () => Promise<void> | void): Promise<void> {
  try {
    await run();
  } catch (error) {
    report.errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function runSmoke(deps: SmokeDeps): Promise<SmokeReport> {
  const timeout = deps.timeoutMs ?? 30_000;
  const report: SmokeReport = {
    ok: false,
    version: deps.app.getVersion(),
    packaged: deps.app.isPackaged,
    userData: deps.app.getPath('userData'),
    errors: [],
  };

  await step(report, 'database', () => {
    const one = (sql: string): Record<string, unknown> => deps.sqlite.prepare(sql).get() as Record<string, unknown>;
    report.sqliteVersion = String(one('SELECT sqlite_version() AS v')['v']);
    report.migrations = Number(one('SELECT count(*) AS n FROM __drizzle_migrations')['n']);
    report.tables = Number(one("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'")['n']);
    if (!report.migrations) throw new Error('no migration was applied');
  });

  await step(report, 'extension host', async () => {
    const hostInfo = { appName: 'Matane Anime', appVersion: report.version, apiVersion: API_VERSION };
    const host = deps.host;
    await withTimeout(
      host.send({ type: 'load', extensionId: 'smoke', code: CODE, manifest: MANIFEST, hostInfo }),
      timeout,
      'loading the sandbox',
    );
    const answer = await withTimeout(
      host.send({ type: 'call', extensionId: 'smoke', sourceKey: 'main', method: 'ping', args: [], prefs: {} }),
      timeout,
      'calling the sandbox',
    );
    const loaded = (await host.send({ type: 'status' })) as unknown[];
    await host.send({ type: 'unload', extensionId: 'smoke' });
    if (answer !== 'pong') throw new Error(`the sandbox answered ${JSON.stringify(answer)}`);
    report.host = { answer, loadedAfterStatus: loaded.length };
  });

  await step(report, 'renderer', async () => {
    const contents = deps.window.webContents;
    if (contents.isLoading()) {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          contents.once('did-finish-load', () => resolve());
          contents.once('did-fail-load', (_event, code, description) => reject(new Error(`${description} (${code})`)));
        }),
        timeout,
        'loading the renderer',
      );
    }
    // React mounts after the module script ran; give it a moment instead of racing it.
    const deadline = Date.now() + timeout;
    let rootChildren = 0;
    while (Date.now() < deadline) {
      rootChildren = Number(
        await contents.executeJavaScript("document.getElementById('root')?.childElementCount ?? 0"),
      );
      if (rootChildren > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    report.renderer = { rootChildren, title: contents.getTitle() };
    if (rootChildren === 0) throw new Error('the renderer did not mount');
  });

  report.ok = report.errors.length === 0;
  return report;
}

/** Prints the report where `scripts/smoke-packaged.mjs` reads it. */
export function printSmokeReport(report: SmokeReport): void {
  process.stdout.write(`${SMOKE_PREFIX}${JSON.stringify(report)}\n`);
}
