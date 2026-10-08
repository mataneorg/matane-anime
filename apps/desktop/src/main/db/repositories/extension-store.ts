import type { ExtensionManifest } from '@matane-anime/extension-sdk/manifest';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { extensionPrefs, extensionStorage, extensions, sources } from '../schema';
import type { ChangeEmitter } from './changes';

export interface SourceRow {
  id: string;
  extensionId: string;
  key: string;
  name: string;
  lang: string;
  /** Whether the extension was 18+ when it last loaded (kept after it is uninstalled). */
  nsfw: boolean;
  pinned: boolean;
  lastUsedAt: number | null;
}

export type ExtensionOrigin = 'dev' | 'repo';

export interface ExtensionRow {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  nsfw: boolean;
  repoId: number | null;
  origin: ExtensionOrigin;
  installDir: string | null;
  sha256: string | null;
  installedAt: number;
  updatedAt: number;
}

/** Where an installed extension came from and lives; passed when the row is written for a repository install. */
export interface InstallInfo {
  repoId: number | null;
  installDir: string;
  sha256: string;
}

/** The `extensions`, `sources`, `extension_prefs` and `extension_storage` tables. */
export class ExtensionStore {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: ChangeEmitter,
  ) {}

  /**
   * Records an extension that just loaded, and its sources. Sources of other extensions are not touched.
   * `updatedAt` moves only when the version does (a hot reload is not an update). A dev folder that loads
   * with the id of an installed repository extension leaves that row alone (EXT-9: only its sources are kept);
   * `install` is how a repository install writes its origin, folder and hash in the same step.
   */
  upsertExtension(manifest: ExtensionManifest, now = Date.now(), install?: InstallInfo): void {
    this.db.transaction((tx) => {
      const existing = tx.select().from(extensions).where(eq(extensions.id, manifest.id)).get();
      const fields = {
        name: manifest.name,
        version: manifest.version,
        apiVersion: manifest.apiVersion,
        nsfw: manifest.nsfw,
      };
      const origin = install ? ({ origin: 'repo', ...install } as const) : undefined;
      if (!existing) {
        tx.insert(extensions)
          .values({
            id: manifest.id,
            ...fields,
            ...(origin && {
              origin: origin.origin,
              repoId: origin.repoId,
              installDir: origin.installDir,
              sha256: origin.sha256,
            }),
            installedAt: now,
            updatedAt: now,
          })
          .run();
      } else if (install || existing.origin !== 'repo') {
        tx.update(extensions)
          .set({
            ...fields,
            ...(origin && {
              origin: origin.origin,
              repoId: origin.repoId,
              installDir: origin.installDir,
              sha256: origin.sha256,
            }),
            ...(existing.version !== manifest.version && { updatedAt: now }),
          })
          .where(eq(extensions.id, manifest.id))
          .run();
      }
      for (const source of manifest.sources) {
        tx.insert(sources)
          .values({
            id: `${manifest.id}/${source.key}`,
            extensionId: manifest.id,
            key: source.key,
            name: source.name,
            lang: source.lang,
            nsfw: manifest.nsfw,
          })
          .onConflictDoUpdate({
            target: sources.id,
            set: { name: source.name, lang: source.lang, nsfw: manifest.nsfw },
          })
          .run();
      }
    });
    this.changes.emit('extensions', 'sources');
  }

  getExtension(id: string): { id: string; name: string; nsfw: boolean } | undefined {
    return this.db
      .select({ id: extensions.id, name: extensions.name, nsfw: extensions.nsfw })
      .from(extensions)
      .where(eq(extensions.id, id))
      .get();
  }

  findExtension(id: string): ExtensionRow | undefined {
    return this.db.select().from(extensions).where(eq(extensions.id, id)).get();
  }

  listExtensions(): ExtensionRow[] {
    return this.db.select().from(extensions).orderBy(extensions.id).all();
  }

  /** Marks an existing row as installed from a repository (or back as a dev one). */
  setInstall(input: {
    id: string;
    repoId: number | null;
    installDir: string | null;
    sha256: string | null;
    origin: ExtensionOrigin;
  }): void {
    this.db
      .update(extensions)
      .set({ repoId: input.repoId, installDir: input.installDir, sha256: input.sha256, origin: input.origin })
      .where(eq(extensions.id, input.id))
      .run();
    this.changes.emit('extensions');
  }

  /** Deletes the row; preferences and storage go with it (cascade). Sources and anime stay on purpose. */
  deleteExtension(id: string): void {
    this.db.delete(extensions).where(eq(extensions.id, id)).run();
    this.changes.emit('extensions', 'sources');
  }

  listSources(): SourceRow[] {
    return this.db.select().from(sources).all();
  }

  getSource(id: string): SourceRow | undefined {
    return this.db.select().from(sources).where(eq(sources.id, id)).get();
  }

  setPinned(sourceId: string, pinned: boolean): void {
    this.db.update(sources).set({ pinned }).where(eq(sources.id, sourceId)).run();
    this.changes.emit('sources');
  }

  touchSource(sourceId: string, now = Date.now()): void {
    this.db.update(sources).set({ lastUsedAt: now }).where(eq(sources.id, sourceId)).run();
  }

  // ------------------------------------------------------------------ preferences

  getPrefs(extensionId: string): Record<string, unknown> {
    const rows = this.db.select().from(extensionPrefs).where(eq(extensionPrefs.extensionId, extensionId)).all();
    return Object.fromEntries(rows.map((row) => [row.key, safeParse(row.valueJson)]));
  }

  setPref(extensionId: string, key: string, value: unknown): void {
    const valueJson = JSON.stringify(value ?? null);
    this.db
      .insert(extensionPrefs)
      .values({ extensionId, key, valueJson })
      .onConflictDoUpdate({ target: [extensionPrefs.extensionId, extensionPrefs.key], set: { valueJson } })
      .run();
  }

  // ------------------------------------------------------------------ storage (the `storage` global)

  storageGet(extensionId: string, key: string): unknown {
    const row = this.db
      .select()
      .from(extensionStorage)
      .where(and(eq(extensionStorage.extensionId, extensionId), eq(extensionStorage.key, key)))
      .get();
    return row ? safeParse(row.valueJson) : null;
  }

  storageSet(extensionId: string, key: string, value: unknown): void {
    const valueJson = JSON.stringify(value ?? null);
    this.db
      .insert(extensionStorage)
      .values({ extensionId, key, valueJson })
      .onConflictDoUpdate({ target: [extensionStorage.extensionId, extensionStorage.key], set: { valueJson } })
      .run();
  }

  storageRemove(extensionId: string, key: string): void {
    this.db
      .delete(extensionStorage)
      .where(and(eq(extensionStorage.extensionId, extensionId), eq(extensionStorage.key, key)))
      .run();
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
