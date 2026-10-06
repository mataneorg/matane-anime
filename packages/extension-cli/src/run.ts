import {
  type CallOptions,
  ExtensionRuntime,
  ExtensionRuntimeError,
  SourceClient,
} from '@matane-anime/extension-runtime';
import { API_VERSION } from '@matane-anime/extension-sdk/manifest';
import { buildExtension } from './build';
import { dim, fail, ok, warn } from './log';
import { type NodeHost, createNodeHost } from './node-host';

export interface LoadedSource {
  client: SourceClient;
  runtime: ExtensionRuntime;
  host: NodeHost;
  prefs: Record<string, unknown>;
  sourceKey: string;
  call: CallOptions;
}

/** `--pref a=1 --pref b=true`: numbers and booleans are read as such, everything else stays text. */
export function parsePrefs(pairs: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at < 1) throw new Error(`--pref wants key=value, got "${pair}"`);
    const raw = pair.slice(at + 1);
    out[pair.slice(0, at)] =
      raw === 'true' ? true : raw === 'false' ? false : raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
  }
  return out;
}

export async function loadSource(
  dir: string,
  options: { source?: string; prefs: string[]; verbose?: boolean },
): Promise<LoadedSource> {
  const built = await buildExtension(dir);
  for (const warning of built.warnings) warn(warning);
  const host = createNodeHost({
    perSecond: built.manifest.rateLimit?.perSecond,
    userAgent: built.manifest.userAgent,
    onLog: (level, message) => {
      if (options.verbose || level === 'warn' || level === 'error') console.log(dim(`  [${level}] ${message}`));
    },
  });
  const runtime = await ExtensionRuntime.create({
    code: built.code,
    manifest: built.manifest,
    host: host.host,
    hostInfo: { appName: 'ma-ext', appVersion: '0.0.0', apiVersion: API_VERSION },
  });
  const sourceKey = options.source ?? built.manifest.sources[0]?.key;
  if (!sourceKey || !built.manifest.sources.some((s) => s.key === sourceKey)) {
    runtime.dispose();
    throw new Error(
      `No such source "${options.source}". The manifest has: ${built.manifest.sources.map((s) => s.key).join(', ')}`,
    );
  }
  const client = new SourceClient(runtime, sourceKey);
  const defaults = Object.fromEntries(client.preferences().map((p) => [p.key, p.default]));
  const prefs = { ...defaults, ...parsePrefs(options.prefs) };
  return { client, runtime, host, prefs, sourceKey, call: { prefs } };
}

const describeError = (error: unknown): string =>
  error instanceof ExtensionRuntimeError
    ? `${error.typed ?? error.errorName ?? error.code}: ${error.message}`
    : String((error as Error).message ?? error);

/** Runs one step, prints one line, and rethrows nothing: the caller decides what a failure means. */
export async function step<T>(
  label: string,
  work: () => Promise<T>,
  describe: (value: T) => string,
): Promise<{ ok: true; value: T; ms: number } | { ok: false }> {
  const started = performance.now();
  try {
    const value = await work();
    const ms = Math.round(performance.now() - started);
    ok(label, `${describe(value)} (${ms} ms)`);
    return { ok: true, value, ms };
  } catch (error) {
    fail(`${label}: ${describeError(error)}`);
    return { ok: false };
  }
}
