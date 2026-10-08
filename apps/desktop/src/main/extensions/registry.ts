import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ExtensionInfo } from '@matane-anime/shared';
import { type ExtensionManifest, manifestSchema } from '@matane-anime/extension-sdk/manifest';
import type { Preference } from '@matane-anime/extension-sdk';
import type { ExtensionStore } from '../db/repositories/extension-store';
import type { SettingsRepository } from '../db/repositories/settings';
import type { ExtensionHostClient } from './host-client';
import type { HostInfo } from './rpc';

export const DEV_FOLDERS_KEY = 'extensions.devFolders';

export interface ExtensionRecord {
  /** What the user picked. */
  inputFolder: string;
  /** Where `manifest.json` and `index.js` were found (the folder itself or its `dist/`). */
  bundleFolder: string | null;
  status: 'ready' | 'error';
  error: string | null;
  manifest: ExtensionManifest | null;
  code: string | null;
  preferences: Preference[];
  /** Newest modification time of the bundle files, for hot reload. */
  mtime: number;
  /** Which host process holds this extension; a different generation means it must be loaded again. */
  loadedIn: number;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** `dist/` if it holds a built extension, else the folder itself. */
async function findBundle(folder: string): Promise<string> {
  for (const candidate of [join(folder, 'dist'), folder]) {
    if ((await exists(join(candidate, 'manifest.json'))) && (await exists(join(candidate, 'index.js'))))
      return candidate;
  }
  throw new Error(
    'Nothing to load here. Build the extension with `ma-ext build`: the folder needs dist/ (or manifest.json and index.js).',
  );
}

async function readBundle(
  folder: string,
): Promise<{ bundle: string; manifest: ExtensionManifest; code: string; mtime: number }> {
  const bundle = await findBundle(folder);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8'));
  } catch (error) {
    throw new Error(`manifest.json cannot be read: ${(error as Error).message}`, { cause: error });
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `manifest.json is not valid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
    );
  }
  const [code, manifestStat, codeStat] = await Promise.all([
    readFile(join(bundle, 'index.js'), 'utf8'),
    stat(join(bundle, 'manifest.json')),
    stat(join(bundle, 'index.js')),
  ]);
  return { bundle, manifest: parsed.data, code, mtime: Math.max(manifestStat.mtimeMs, codeStat.mtimeMs) };
}

export interface RegistryDeps {
  host: ExtensionHostClient;
  store: ExtensionStore;
  settings: SettingsRepository;
  hostInfo: HostInfo;
  /** Called when an extension (re)loaded so its network limits and cached results are dropped. */
  onReloaded(extensionId: string): void;
  onChanged(): void;
}

/**
 * Extensions in phase 1 come from folders the user picked (docs/PRD.md EXT-10; repositories are phase 4).
 * A folder that fails to load stays listed with its error. Bundles are checked for changes about once a
 * second, so `ma-ext build` hot-reloads the extension.
 */
export class ExtensionRegistry {
  private readonly records = new Map<string, ExtensionRecord>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly deps: RegistryDeps;

  constructor(deps: RegistryDeps) {
    this.deps = deps;
  }

  async init(): Promise<void> {
    const folders = this.deps.settings.getValue<string[]>(DEV_FOLDERS_KEY, []);
    await Promise.all(folders.map((folder) => this.load(folder, false)));
    this.timer = setInterval(() => void this.checkForChanges(), 1000);
    this.timer.unref();
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ queries

  list(): ExtensionInfo[] {
    return [...this.records.values()].map((record) => this.info(record));
  }

  /** Records by extension id (ready ones only). */
  byExtensionId(id: string): ExtensionRecord | undefined {
    return [...this.records.values()].find((record) => record.manifest?.id === id && record.status === 'ready');
  }

  byFolder(folder: string): ExtensionRecord | undefined {
    return this.records.get(resolve(folder));
  }

  info(record: ExtensionRecord): ExtensionInfo {
    const manifest = record.manifest;
    return {
      id: manifest?.id ?? record.inputFolder,
      key: record.inputFolder,
      folder: record.inputFolder,
      origin: 'dev',
      repoId: null,
      repoName: null,
      trust: null,
      updateAvailable: null,
      shadowed: false,
      status: record.status,
      error: record.error,
      name: manifest?.name ?? record.inputFolder.split(/[\\/]/).pop() ?? record.inputFolder,
      version: manifest?.version ?? null,
      nsfw: manifest?.nsfw ?? false,
      hasPreferences: record.preferences.length > 0,
      sources: (manifest?.sources ?? []).map((source) => ({
        id: `${manifest?.id}/${source.key}`,
        key: source.key,
        lang: source.lang,
        name: source.name,
      })),
    };
  }

  // ------------------------------------------------------------------ changes

  async loadFolder(folder: string): Promise<ExtensionInfo> {
    return this.info(await this.load(folder, true));
  }

  async removeFolder(folder: string): Promise<void> {
    const key = resolve(folder);
    const record = this.records.get(key);
    this.records.delete(key);
    this.persist();
    if (record?.manifest) {
      this.deps.onReloaded(record.manifest.id);
      await this.deps.host.send({ type: 'unload', extensionId: record.manifest.id }).catch(() => undefined);
    }
    this.deps.onChanged();
  }

  /** Makes sure the host process holds this extension, loading it if it was unloaded or the host restarted. */
  async ensureLoaded(record: ExtensionRecord): Promise<void> {
    if (record.status !== 'ready' || !record.manifest || record.code === null) {
      throw new Error(record.error ?? 'The extension is not available');
    }
    if (record.loadedIn === this.deps.host.generation && this.deps.host.isRunning) return;
    await this.deps.host.send({
      type: 'load',
      extensionId: record.manifest.id,
      code: record.code,
      manifest: record.manifest,
      hostInfo: this.deps.hostInfo,
    });
    record.loadedIn = this.deps.host.generation;
  }

  /** The host died or was stopped: nothing is loaded in whatever process comes next. */
  hostExited(): void {
    for (const record of this.records.values()) record.loadedIn = -1;
  }

  /** Forces the next call to load again (the host reported `not_loaded`). */
  markUnloaded(record: ExtensionRecord): void {
    record.loadedIn = -1;
  }

  private persist(): void {
    this.deps.settings.setValue(DEV_FOLDERS_KEY, [...this.records.keys()]);
  }

  private async load(folder: string, persist: boolean): Promise<ExtensionRecord> {
    const inputFolder = resolve(folder);
    const previous = this.records.get(inputFolder);
    const record: ExtensionRecord = {
      inputFolder,
      bundleFolder: null,
      status: 'error',
      error: null,
      manifest: null,
      code: null,
      preferences: [],
      mtime: 0,
      loadedIn: -1,
    };
    try {
      const { bundle, manifest, code, mtime } = await readBundle(inputFolder);
      const other = this.byExtensionId(manifest.id);
      if (other && other.inputFolder !== inputFolder) {
        throw new Error(
          `"${manifest.id}" is already loaded from ${other.inputFolder}. An extension id can come from one place at a time.`,
        );
      }
      Object.assign(record, { bundleFolder: bundle, manifest, code, mtime });
      // Load it into the sandbox now, so a broken bundle is reported here and not on the first browse.
      this.records.set(inputFolder, record);
      await this.deps.host.send({ type: 'unload', extensionId: manifest.id }).catch(() => undefined);
      await this.ensureLoaded({ ...record, status: 'ready' }).then(() => undefined);
      record.status = 'ready';
      record.loadedIn = this.deps.host.generation;
      record.preferences = (await this.deps.host.send({
        type: 'preferences',
        extensionId: manifest.id,
      })) as Preference[];
      this.deps.store.upsertExtension(manifest);
      this.deps.onReloaded(manifest.id);
    } catch (error) {
      record.status = 'error';
      record.error = (error as Error).message;
      if (previous?.manifest && !record.manifest) record.manifest = null;
    }
    this.records.set(inputFolder, record);
    if (persist) this.persist();
    this.deps.onChanged();
    return record;
  }

  private async checkForChanges(): Promise<void> {
    for (const record of [...this.records.values()]) {
      try {
        const folder = record.bundleFolder ?? (await findBundle(record.inputFolder));
        const [a, b] = await Promise.all([stat(join(folder, 'manifest.json')), stat(join(folder, 'index.js'))]);
        const mtime = Math.max(a.mtimeMs, b.mtimeMs);
        // An errored folder that gained a bundle, or a bundle that was rebuilt.
        if (mtime !== record.mtime || record.bundleFolder === null) await this.load(record.inputFolder, false);
      } catch {
        // Still not built, or briefly missing while the build rewrites it: try again next second.
      }
    }
  }
}
