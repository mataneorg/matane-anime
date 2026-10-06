import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type HostApi, ExtensionRuntime, preferenceListSchema } from '@matane-anime/extension-runtime';
import { API_VERSION, type ExtensionManifest, manifestSchema } from '@matane-anime/extension-sdk/manifest';
import { build as esbuild } from 'esbuild';

export class BuildError extends Error {
  override name = 'BuildError';
}

export interface BuildResult {
  dir: string;
  outDir: string;
  code: string;
  manifest: ExtensionManifest;
  warnings: string[];
}

const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

/** A host that fails every request: loading a bundle must not touch the network. */
const NO_HOST: HostApi = {
  http: async () => {
    throw new Error('the network is not available while checking the bundle');
  },
  storage: { get: async () => null, set: async () => undefined, remove: async () => undefined },
  log: () => undefined,
};

export async function readManifest(dir: string): Promise<ExtensionManifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  } catch (error) {
    throw new BuildError(`Cannot read ${join(dir, 'manifest.json')}: ${(error as Error).message}`);
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BuildError(
      `manifest.json is not valid:\n${parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')}`,
    );
  }
  return parsed.data;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/**
 * Bundles `src/index.ts` into one ES2020 script, checks it the way the app will load it, and writes
 * `dist/{index.js, manifest.json, icon.png}`.
 */
export async function buildExtension(directory: string, options: { write?: boolean } = {}): Promise<BuildResult> {
  const dir = resolve(directory);
  const manifest = await readManifest(dir);
  if (manifest.apiVersion > API_VERSION) {
    throw new BuildError(`apiVersion ${manifest.apiVersion} is newer than this tool understands (${API_VERSION}).`);
  }
  const entry = ['src/index.ts', 'src/index.js'].map((file) => join(dir, file));
  const entryFile = (await Promise.all(entry.map(exists))).findIndex(Boolean);
  if (entryFile === -1) throw new BuildError('No entry file: expected src/index.ts');

  const result = await esbuild({
    entryPoints: [entry[entryFile] as string],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__bundle',
    target: 'es2020',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    // Registers the default export with the host; `defineExtension(...)` must be that export.
    footer: { js: ';globalThis.__extension = __bundle.default;' },
    logLevel: 'silent',
    absWorkingDir: dir,
  }).catch((error: { errors?: { text: string; location?: { file: string; line: number } | null }[] }) => {
    const lines = (error.errors ?? []).map(
      (e) => `  ${e.location ? `${e.location.file}:${e.location.line}: ` : ''}${e.text}`,
    );
    throw new BuildError(`Bundling failed:\n${lines.join('\n') || String(error)}`);
  });
  const code = result.outputFiles?.[0]?.text ?? '';
  const warnings = result.warnings.map((w) => w.text);

  if (/\brequire\s*\(/.test(code) || /\bimport\s*\(/.test(code)) {
    throw new BuildError('The bundle calls require() or import(): the sandbox has neither. Bundle what you need.');
  }
  if (Buffer.byteLength(code) > MAX_BUNDLE_BYTES) {
    throw new BuildError(`The bundle is ${(Buffer.byteLength(code) / 1048576).toFixed(1)} MB; the limit is 2 MB.`);
  }

  // Load it as the app will: the globals are the sandbox's, and the entry must register an extension.
  const runtime = await ExtensionRuntime.create({
    code,
    manifest,
    host: NO_HOST,
    hostInfo: { appName: 'ma-ext', appVersion: '0.0.0', apiVersion: API_VERSION },
  }).catch((error: Error) => {
    throw new BuildError(`The bundle does not load in the sandbox: ${error.message}`);
  });
  try {
    const preferences = preferenceListSchema.safeParse(runtime.preferences());
    if (!preferences.success) throw new BuildError(`preferences() is not valid: ${preferences.error.message}`);
  } finally {
    runtime.dispose();
  }

  const outDir = join(dir, 'dist');
  if (options.write !== false) {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'index.js'), code);
    await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    if (await exists(join(dir, 'icon.png'))) await copyFile(join(dir, 'icon.png'), join(outDir, 'icon.png'));
    else warnings.push('No icon.png next to manifest.json; repositories will require one.');
  }
  return { dir, outDir, code, manifest, warnings };
}
