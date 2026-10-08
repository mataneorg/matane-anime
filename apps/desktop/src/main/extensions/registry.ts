import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MAX_BUNDLE_BYTES } from '@matane-anime/extension-repo';
import type { ExtensionInfo } from '@matane-anime/shared';
import { API_VERSION, type ExtensionManifest, manifestSchema } from '@matane-anime/extension-sdk/manifest';
import type { Preference } from '@matane-anime/extension-sdk';
import type { ExtensionStore } from '../db/repositories/extension-store';
import type { SettingsRepository } from '../db/repositories/settings';
import type { ExtensionHostClient } from './host-client';
import type { RepoLookup } from './repos';
import type { HostInfo } from './rpc';

export const DEV_FOLDERS_KEY = 'extensions.devFolders';

export interface ExtensionRecord {
  /** `dev`: a folder the user picked; `repo`: installed from a repository into the user data folder. */
  origin: 'dev' | 'repo';
  /** Dev: what the user picked. Repo: the folder the extension was installed into. */
  inputFolder: string;
  /** Repo records only: the id the install was recorded under, known even when the files cannot be read. */
  extensionId: string | null;
  /** Repo records only: SHA-256 of `index.js` recorded at install, checked on every load. */
  expectedSha256: string | null;
  /** A dev folder with the same id is loaded instead of this installed copy (EXT-9). */
  shadowed: boolean;
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

async function readBundle(folder: string): Promise<{
  bundle: string;
  manifest: ExtensionManifest;
  code: string;
  mtime: number;
  bytes: number;
  sha256: string;
}> {
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
  const [codeBytes, manifestStat, codeStat] = await Promise.all([
    readFile(join(bundle, 'index.js')),
    stat(join(bundle, 'manifest.json')),
    stat(join(bundle, 'index.js')),
  ]);
  return {
    bundle,
    manifest: parsed.data,
    code: codeBytes.toString('utf8'),
    mtime: Math.max(manifestStat.mtimeMs, codeStat.mtimeMs),
    bytes: codeBytes.length,
    sha256: createHash('sha256').update(codeBytes).digest('hex'),
  };
}

/** The files of an installed extension changed after the install (or cannot be trusted any more). */
const MODIFIED = 'The installed files were changed; reinstall the extension.';

export interface InstalledExtension {
  id: string;
  installDir: string;
  /** SHA-256 of `index.js` recorded when it was installed. */
  sha256: string | null;
  repoId: number | null;
}

export interface RegistryDeps {
  host: ExtensionHostClient;
  store: ExtensionStore;
  settings: SettingsRepository;
  hostInfo: HostInfo;
  /** Called when an extension (re)loaded so its network limits and cached results are dropped. */
  onReloaded(extensionId: string): void;
  onChanged(): void;
  /** The repositories, for the trust and update fields of `info()`. */
  repos?: RepoLookup;
}

function newRecord(origin: 'dev' | 'repo', inputFolder: string): ExtensionRecord {
  return {
    origin,
    inputFolder,
    extensionId: null,
    expectedSha256: null,
    shadowed: false,
    bundleFolder: null,
    status: 'error',
    error: null,
    manifest: null,
    code: null,
    preferences: [],
    mtime: 0,
    loadedIn: -1,
  };
}

/**
 * Every extension the app can run, from two origins (docs/PRD.md EXT-9, ADR 0013): folders the user picked
 * (`dev`, hot reloaded) and extensions installed from a repository (`repo`, loaded from their install folder
 * after their `index.js` is checked against the hash recorded at install). One id comes from one origin: a dev
 * folder wins, and the installed copy is reported `shadowed` until the folder goes away or fails to load.
 * A folder that fails to load stays listed with its error. Dev bundles are checked for changes about once a
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
    const installed = this.deps.store.listExtensions().filter((row) => row.origin === 'repo');
    await Promise.all(
      installed.map((row) =>
        this.loadInstalled({ id: row.id, installDir: row.installDir ?? '', sha256: row.sha256, repoId: row.repoId }),
      ),
    );
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

  /** Records by extension id (ready ones only; an installed copy hidden by a dev folder is not returned). */
  byExtensionId(id: string): ExtensionRecord | undefined {
    return [...this.records.values()].find(
      (record) => record.manifest?.id === id && record.status === 'ready' && !record.shadowed,
    );
  }

  byFolder(folder: string): ExtensionRecord | undefined {
    return this.records.get(resolve(folder));
  }

  /** A dev folder provides this id right now (EXT-9: it wins over repositories). */
  isDevLoaded(id: string): boolean {
    return [...this.records.values()].some(
      (record) => record.origin === 'dev' && record.status === 'ready' && record.manifest?.id === id,
    );
  }

  isShadowed(id: string): boolean {
    return this.records.get(id)?.shadowed === true;
  }

  info(record: ExtensionRecord): ExtensionInfo {
    const manifest = record.manifest;
    const repo = record.origin === 'repo';
    const id = manifest?.id ?? record.extensionId ?? record.inputFolder;
    const row = repo ? this.deps.store.findExtension(id) : undefined;
    const repoId = row?.repoId ?? null;
    const version = manifest?.version ?? row?.version ?? null;
    const description = repoId === null ? null : (this.deps.repos?.describe(repoId) ?? null);
    const sources = manifest
      ? manifest.sources
      : this.deps.store.listSources().filter((source) => source.extensionId === id);
    return {
      id,
      key: repo ? id : record.inputFolder,
      folder: repo ? null : record.inputFolder,
      origin: record.origin,
      repoId,
      repoName: description?.name ?? null,
      trust: description?.trust ?? null,
      updateAvailable:
        repoId !== null && version !== null ? (this.deps.repos?.newerVersion(repoId, id, version) ?? null) : null,
      shadowed: record.shadowed,
      status: record.status,
      error: record.error,
      name: manifest?.name ?? row?.name ?? record.inputFolder.split(/[\\/]/).pop() ?? record.inputFolder,
      version,
      nsfw: manifest?.nsfw ?? row?.nsfw ?? false,
      hasPreferences: record.preferences.length > 0,
      sources: sources.map((source) => ({
        id: `${id}/${source.key}`,
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
      await this.reconcile(record.manifest.id);
    }
    this.deps.onChanged();
  }

  /**
   * Loads (or reloads) an installed extension from its folder. Before anything of it runs, `index.js` must
   * match the hash recorded at install, fit the size limit, carry the expected id and an `apiVersion` this
   * app supports; otherwise the record is an error and nothing reaches the sandbox.
   */
  async loadInstalled(install: InstalledExtension): Promise<ExtensionRecord> {
    const record = newRecord('repo', install.installDir);
    record.extensionId = install.id;
    record.expectedSha256 = install.sha256;
    try {
      if (!install.installDir) throw new Error('The extension files are missing; reinstall the extension.');
      const { bundle, manifest, code, mtime, bytes, sha256 } = await readBundle(install.installDir).catch(
        (error: unknown) => {
          throw new Error(
            `The installed files cannot be read (${(error as Error).message}); reinstall the extension.`,
            {
              cause: error,
            },
          );
        },
      );
      if (bytes > MAX_BUNDLE_BYTES)
        throw new Error(`The installed extension is larger than ${MAX_BUNDLE_BYTES / (1024 * 1024)} MB.`);
      if (install.sha256 === null || sha256 !== install.sha256) throw new Error(MODIFIED);
      if (manifest.id !== install.id) throw new Error(MODIFIED);
      if (manifest.apiVersion > API_VERSION) {
        throw new Error(
          `This extension needs API ${manifest.apiVersion}; this app supports up to ${API_VERSION}. Update the app.`,
        );
      }
      Object.assign(record, { bundleFolder: bundle, manifest, code, mtime });
      if (this.isDevLoaded(manifest.id)) {
        // EXT-9: the dev folder runs; this copy waits (and is checked again when it comes back).
        record.shadowed = true;
        record.status = 'ready';
      } else {
        this.records.set(install.id, record);
        await this.deps.host.send({ type: 'unload', extensionId: manifest.id }).catch(() => undefined);
        await this.ensureLoaded({ ...record, status: 'ready' });
        record.status = 'ready';
        record.loadedIn = this.deps.host.generation;
        record.preferences = (await this.deps.host.send({
          type: 'preferences',
          extensionId: manifest.id,
        })) as Preference[];
      }
      this.deps.store.upsertExtension(manifest, Date.now(), {
        repoId: install.repoId,
        installDir: install.installDir,
        sha256: install.sha256 as string,
      });
      this.deps.onReloaded(manifest.id);
    } catch (error) {
      record.status = 'error';
      record.error = (error as Error).message;
      record.manifest = null;
      record.code = null;
      // A copy that failed must not stay in the sandbox (unless a dev folder owns that slot).
      if (!this.isDevLoaded(install.id)) {
        await this.deps.host.send({ type: 'unload', extensionId: install.id }).catch(() => undefined);
      }
    }
    this.records.set(install.id, record);
    this.deps.onChanged();
    return record;
  }

  /** Forgets an installed extension: it leaves the sandbox and the list. The row and the files are the caller's. */
  async unloadInstalled(id: string): Promise<void> {
    const record = this.records.get(id);
    if (record?.origin !== 'repo') return;
    this.records.delete(id);
    // A dev folder with this id owns the sandbox slot.
    if (!this.isDevLoaded(id)) await this.deps.host.send({ type: 'unload', extensionId: id }).catch(() => undefined);
    this.deps.onReloaded(id);
    this.deps.onChanged();
  }

  /** Makes sure the host process holds this extension, loading it if it was unloaded or the host restarted. */
  async ensureLoaded(record: ExtensionRecord): Promise<void> {
    if (record.status !== 'ready' || !record.manifest || record.code === null || record.shadowed) {
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
    const folders = [...this.records.values()].filter((record) => record.origin === 'dev').map((r) => r.inputFolder);
    this.deps.settings.setValue(DEV_FOLDERS_KEY, folders);
  }

  /**
   * Applies EXT-9 for one id after a dev folder appeared, changed or went: an installed copy is shadowed
   * while a dev folder provides the id and loaded again (from disk, checked again) once none does.
   */
  private async reconcile(extensionId: string): Promise<void> {
    const installed = this.records.get(extensionId);
    if (installed?.origin !== 'repo') return;
    const devLoaded = this.isDevLoaded(extensionId);
    if (devLoaded && !installed.shadowed) {
      installed.shadowed = true;
      installed.loadedIn = -1;
    } else if (!devLoaded && installed.shadowed) {
      await this.loadInstalled({
        id: extensionId,
        installDir: installed.inputFolder,
        sha256: installed.expectedSha256,
        repoId: this.deps.store.findExtension(extensionId)?.repoId ?? null,
      });
    }
  }

  private async load(folder: string, persist: boolean): Promise<ExtensionRecord> {
    const inputFolder = resolve(folder);
    const previous = this.records.get(inputFolder);
    const record = newRecord('dev', inputFolder);
    try {
      const { bundle, manifest, code, mtime } = await readBundle(inputFolder);
      const other = this.byExtensionId(manifest.id);
      if (other && other.origin === 'dev' && other.inputFolder !== inputFolder) {
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
    // EXT-9: an installed copy steps aside for a dev folder that runs, and comes back when it stops running.
    for (const id of new Set([record.manifest?.id, previous?.manifest?.id])) {
      if (id) await this.reconcile(id);
    }
    this.deps.onChanged();
    return record;
  }

  private async checkForChanges(): Promise<void> {
    for (const record of [...this.records.values()]) {
      if (record.origin !== 'dev') continue;
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
