import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import {
  type ExtensionPackage,
  type IndexEntry,
  MAX_ARCHIVE_BYTES,
  MAX_ICON_BYTES,
  fingerprint,
  isNewer,
  resolveUrl,
  sha256Hex,
  verifyPackage,
} from '@matane-anime/extension-repo';
import { API_VERSION } from '@matane-anime/extension-sdk/manifest';
import { AppError, type InstallPreparation, type UpdateAllResult } from '@matane-anime/shared';
import type { ExtensionRow, ExtensionStore } from '../db/repositories/extension-store';
import type { RepoRow } from '../db/repositories/extension-repos';
import { pathExists, removePath } from '../downloads/atomic';
import type { InstalledExtension } from './registry';
import type { RepoHttp } from './repo-http';
import { type RepoService, toRepoAppError } from './repos';

/** A prepared install waits this long for the user's confirmation. */
export const TOKEN_TTL_MS = 5 * 60_000;
/** At most this many prepared installs are kept; the oldest is dropped. */
export const MAX_TOKENS = 5;

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** What `InstallService` needs from the registry. */
export interface InstallRegistry {
  loadInstalled(install: InstalledExtension): Promise<{ status: 'ready' | 'error'; error: string | null }>;
  unloadInstalled(id: string): Promise<void>;
  isDevLoaded(id: string): boolean;
  isShadowed(id: string): boolean;
}

/** File operations of the atomic swap, replaceable in tests to make one fail. */
export interface InstallFs {
  mkdir(path: string): Promise<void>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<string[]>;
}

const realFs: InstallFs = {
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, data) => writeFile(path, data),
  rename,
  remove: removePath,
  exists: pathExists,
  list: (path) => readdir(path).catch(() => []),
};

export interface InstallServiceDeps {
  http: RepoHttp;
  repos: RepoService;
  store: ExtensionStore;
  registry: InstallRegistry;
  /** `userData/extensions`: one folder per installed extension id. */
  extensionsDir: string;
  /** Runs the url migration of one extension (EXT-16); failures are logged, never fail the install. */
  migrate(extensionId: string): Promise<void>;
  /** Clears the cookies, storage and cache of the extension's session (`persist:ext-<id>`). */
  clearSession(extensionId: string): Promise<void>;
  /** Drops the extension's network limits. */
  invalidateNetwork(extensionId: string): void;
  now?(): number;
  randomToken?(): string;
  fs?: Partial<InstallFs>;
  log?: { warn(message: string, error?: unknown): void };
}

interface Prepared {
  repoId: number;
  entry: IndexEntry;
  pkg: ExtensionPackage;
  expiresAt: number;
  createdAt: number;
}

/**
 * Installing, updating and removing extensions of repositories (docs/PRD.md EXT-8). Installing has two steps:
 * `prepareInstall` downloads and verifies everything and keeps the verified bytes in memory under a token;
 * `install` only writes. Files are written next to the target and swapped in by renames, so a failure at any
 * step leaves the previous version in place.
 */
export class InstallService {
  private readonly prepared = new Map<string, Prepared>();
  private readonly fs: InstallFs;
  private readonly now: () => number;
  /** Writes are one at a time: two swaps of the same folder must not interleave. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: InstallServiceDeps) {
    this.fs = { ...realFs, ...deps.fs };
    this.now = deps.now ?? Date.now;
  }

  // ------------------------------------------------------------------ install (two steps)

  async prepareInstall(input: { repoId: number; extensionId: string }): Promise<InstallPreparation> {
    const found = this.deps.repos.entryOf(input.repoId, input.extensionId);
    if (!found) throw new AppError('not_found', 'That extension is no longer offered by the repository.');
    const { repo, entry, trust } = found;
    this.assertCompatible(entry);
    const row = this.deps.store.findExtension(entry.id);
    this.assertNoConflict(entry.id, row, repo.id);

    const pkg = await this.download(repo, entry);
    this.dropExpired();
    for (const [token, item] of this.prepared) {
      if (item.entry.id === entry.id) this.prepared.delete(token);
    }
    while (this.prepared.size >= MAX_TOKENS) {
      const oldest = [...this.prepared].sort(([, a], [, b]) => a.createdAt - b.createdAt)[0];
      if (!oldest) break;
      this.prepared.delete(oldest[0]);
    }
    const token = this.deps.randomToken?.() ?? randomBytes(16).toString('hex');
    const now = this.now();
    this.prepared.set(token, { repoId: repo.id, entry, pkg, createdAt: now, expiresAt: now + TOKEN_TTL_MS });

    return {
      token,
      repo: {
        id: repo.id,
        name: repo.name,
        trust,
        fingerprint: repo.signingKey ? fingerprint(repo.signingKey) : null,
      },
      extension: {
        id: entry.id,
        name: entry.name,
        version: entry.version,
        apiVersion: entry.apiVersion,
        langs: entry.langs,
        nsfw: entry.nsfw,
        size: entry.size,
        sha256: entry.sha256,
      },
      installedVersion: row && (row.origin === 'repo' || this.deps.registry.isDevLoaded(row.id)) ? row.version : null,
      warnings: [
        ...(trust === 'unverified' ? (['unverified'] as const) : []),
        ...(trust === 'unsigned' ? (['unsigned'] as const) : []),
        ...(entry.nsfw ? (['nsfw'] as const) : []),
      ],
    };
  }

  /** The second step. The token is used up whatever happens: a failed install is prepared again. */
  async install(token: string): Promise<void> {
    this.dropExpired();
    const item = this.prepared.get(token);
    this.prepared.delete(token);
    if (!item) throw new AppError('invalid_input', 'This install request expired. Start the install again.');
    return this.serial(async () => {
      const repo = this.deps.repos.entryOf(item.repoId, item.entry.id)?.repo;
      if (!repo) throw new AppError('not_found', 'The repository was removed in the meantime.');
      this.assertNoConflict(item.entry.id, this.deps.store.findExtension(item.entry.id), repo.id);
      await this.apply(item.pkg, item.entry, repo.id);
    });
  }

  // ------------------------------------------------------------------ update

  /** Installs the newer version from the repository the copy came from; no dialog (EXT-8). */
  update(extensionId: string): Promise<void> {
    return this.serial(async () => {
      const row = this.deps.store.findExtension(extensionId);
      if (!row || row.origin !== 'repo') {
        throw new AppError(
          'invalid_input',
          `"${extensionId}" was not installed from a repository, so it has no updates.`,
        );
      }
      if (row.repoId === null) {
        throw new AppError(
          'invalid_input',
          'The repository this extension came from was removed, so it has no updates.',
        );
      }
      const found = this.deps.repos.entryOf(row.repoId, extensionId);
      if (!found) throw new AppError('not_found', 'The repository no longer offers this extension.');
      if (!isNewer(found.entry.version, row.version)) {
        throw new AppError('invalid_input', `"${row.name}" is already up to date.`);
      }
      this.assertCompatible(found.entry);
      const pkg = await this.download(found.repo, found.entry);
      await this.apply(pkg, found.entry, found.repo.id);
    });
  }

  /** Updates everything that has a newer, compatible version. One failure does not stop the rest. */
  async updateAll(): Promise<UpdateAllResult> {
    const result: UpdateAllResult = { updated: [], failed: [] };
    for (const row of this.deps.store.listExtensions()) {
      if (row.origin !== 'repo' || row.repoId === null) continue;
      const found = this.deps.repos.entryOf(row.repoId, row.id);
      if (!found || !isNewer(found.entry.version, row.version) || this.deps.repos.incompatibility(found.entry))
        continue;
      try {
        await this.update(row.id);
        result.updated.push(row.id);
      } catch (error) {
        result.failed.push({ id: row.id, message: toRepoAppError(error, 'the extension').message });
        this.deps.log?.warn(`could not update ${row.id}`, error);
      }
    }
    return result;
  }

  // ------------------------------------------------------------------ uninstall

  /** Files, row, preferences, storage and session go; sources and anime stay (shown as "not installed"). */
  uninstall(extensionId: string): Promise<void> {
    return this.serial(async () => {
      const row = this.deps.store.findExtension(extensionId);
      if (!row) throw new AppError('not_found', `"${extensionId}" is not installed.`);
      if (row.origin !== 'repo') {
        throw new AppError('forbidden', 'This extension is loaded from a folder; remove the folder instead.');
      }
      if (this.deps.registry.isShadowed(extensionId)) {
        throw new AppError('forbidden', 'A dev folder is running this extension. Remove the folder first.');
      }
      await this.deps.registry.unloadInstalled(extensionId);
      await this.removeFiles(row);
      this.deps.store.deleteExtension(extensionId);
      this.deps.invalidateNetwork(extensionId);
      try {
        await this.deps.clearSession(extensionId);
      } catch (error) {
        this.deps.log?.warn(`could not clear the session of ${extensionId}`, error);
      }
    });
  }

  /**
   * At startup: a crash during a swap can leave `<id>.tmp` (never complete: dropped) or `<id>.old` next to a
   * missing `<id>` (the previous version: put back) or next to a new one (dropped).
   */
  async recoverInterrupted(): Promise<void> {
    const { extensionsDir } = this.deps;
    for (const name of await this.fs.list(extensionsDir)) {
      const path = join(extensionsDir, name);
      if (name.endsWith('.tmp')) {
        await this.fs.remove(path);
      } else if (name.endsWith('.old')) {
        const target = join(extensionsDir, name.slice(0, -'.old'.length));
        if (await this.fs.exists(target)) await this.fs.remove(path);
        else await this.fs.rename(path, target);
      }
    }
  }

  // ------------------------------------------------------------------ internals

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private dropExpired(): void {
    const now = this.now();
    for (const [token, item] of this.prepared) {
      if (item.expiresAt <= now) this.prepared.delete(token);
    }
  }

  private assertCompatible(entry: IndexEntry): void {
    const reason = this.deps.repos.incompatibility(entry);
    if (reason === 'api') {
      throw new AppError(
        'unsupported',
        `"${entry.name}" needs extension API ${entry.apiVersion}; this app supports up to ${API_VERSION}. Update the app to install it.`,
      );
    }
    if (reason === 'app') {
      throw new AppError(
        'unsupported',
        `"${entry.name}" needs Matane Anime ${entry.minAppVersion} or newer. Update the app to install it.`,
      );
    }
  }

  /** EXT-9: one id comes from one origin. A repository that lost its row may be replaced by another one. */
  private assertNoConflict(extensionId: string, row: ExtensionRow | undefined, repoId: number): void {
    if (this.deps.registry.isDevLoaded(extensionId)) {
      throw new AppError(
        'forbidden',
        `"${extensionId}" is loaded from a dev folder. Remove the folder before installing it from a repository.`,
      );
    }
    if (row?.origin === 'repo' && row.repoId !== null && row.repoId !== repoId) {
      const name = this.deps.repos.describe(row.repoId)?.name ?? 'another repository';
      throw new AppError(
        'forbidden',
        `"${extensionId}" is already installed from ${name}. An extension id can come from one repository at a time; uninstall it first.`,
      );
    }
  }

  private async download(repo: RepoRow, entry: IndexEntry): Promise<ExtensionPackage> {
    const { http } = this.deps;
    const base = `${repo.url}index.json`;
    try {
      const archive = await http.get(resolveUrl(base, entry.archive), {
        maxBytes: Math.min(entry.size, MAX_ARCHIVE_BYTES),
      });
      const icon = await http.get(resolveUrl(base, entry.icon), { maxBytes: Math.min(entry.iconSize, MAX_ICON_BYTES) });
      return verifyPackage(entry, archive.bytes, icon.bytes);
    } catch (error) {
      throw toRepoAppError(error, `"${entry.name}"`);
    }
  }

  /** Writes the verified package, swaps it in, loads it, and rolls everything back if loading fails. */
  private async apply(pkg: ExtensionPackage, entry: IndexEntry, repoId: number): Promise<void> {
    const { extensionsDir, registry, store } = this.deps;
    const id = entry.id;
    if (!ID_PATTERN.test(id)) throw new AppError('invalid_input', 'The extension id is not valid.');
    const dir = join(extensionsDir, id);
    const tmp = `${dir}.tmp`;
    const old = `${dir}.old`;
    const sha256 = sha256Hex(pkg.code);
    const previous = store.findExtension(id);
    const previousInstall: InstalledExtension | null =
      previous?.origin === 'repo' && previous.installDir
        ? { id, installDir: previous.installDir, sha256: previous.sha256, repoId: previous.repoId }
        : null;

    await this.fs.remove(tmp);
    await this.fs.remove(old);
    try {
      await this.fs.mkdir(tmp);
      await this.fs.writeFile(join(tmp, 'manifest.json'), `${JSON.stringify(pkg.manifest, null, 2)}\n`);
      await this.fs.writeFile(join(tmp, 'index.js'), pkg.code);
      await this.fs.writeFile(join(tmp, 'icon.png'), pkg.icon);
    } catch (error) {
      await this.fs.remove(tmp);
      throw new AppError('internal', `Could not write the extension files: ${(error as Error).message}`);
    }

    const hadOld = await this.fs.exists(dir);
    try {
      if (hadOld) await this.fs.rename(dir, old);
      await this.fs.rename(tmp, dir);
    } catch (error) {
      // Put the previous version back before reporting.
      await this.fs.remove(tmp);
      if (hadOld && !(await this.fs.exists(dir))) await this.fs.rename(old, dir).catch(() => undefined);
      throw new AppError('internal', `Could not install the extension: ${(error as Error).message}`);
    }

    let failure: string | null = null;
    try {
      const record = await registry.loadInstalled({ id, installDir: dir, sha256, repoId });
      if (record.status === 'error') failure = record.error ?? 'It did not load.';
    } catch (error) {
      failure = (error as Error).message;
    }
    if (failure !== null) {
      await this.fs.remove(dir);
      if (hadOld)
        await this.fs.rename(old, dir).catch((error: unknown) => this.deps.log?.warn('rollback failed', error));
      // The sandbox and the list go back to what they were.
      if (previousInstall && hadOld) await registry.loadInstalled(previousInstall).catch(() => undefined);
      else await registry.unloadInstalled(id).catch(() => undefined);
      throw new AppError('extension', `"${entry.name}" could not be loaded, so nothing was changed. ${failure}`);
    }
    await this.fs.remove(old);
    this.deps.invalidateNetwork(id);
    try {
      await this.deps.migrate(id);
    } catch (error) {
      this.deps.log?.warn(`could not migrate the urls of ${id}`, error);
    }
  }

  private async removeFiles(row: ExtensionRow): Promise<void> {
    const { extensionsDir } = this.deps;
    const dir = join(extensionsDir, row.id);
    // The folder in the database is only trusted when it is inside the extensions folder.
    const recorded = row.installDir ? resolve(row.installDir) : null;
    if (recorded !== null && recorded !== dir && !isInside(extensionsDir, recorded)) {
      this.deps.log?.warn(`not deleting ${recorded}: it is outside the extensions folder`);
    } else if (recorded !== null && recorded !== dir) {
      await this.fs.remove(recorded);
    }
    await this.fs.remove(dir);
    await this.fs.remove(`${dir}.tmp`);
    await this.fs.remove(`${dir}.old`);
  }
}

function isInside(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
}
