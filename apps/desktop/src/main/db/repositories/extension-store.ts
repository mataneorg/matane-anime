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
  pinned: boolean;
  lastUsedAt: number | null;
}

/** The `extensions`, `sources`, `extension_prefs` and `extension_storage` tables. */
export class ExtensionStore {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: ChangeEmitter,
  ) {}

  /** Records an extension that just loaded, and its sources. Sources of other extensions are not touched. */
  upsertExtension(manifest: ExtensionManifest, now = Date.now()): void {
    this.db.transaction((tx) => {
      tx.insert(extensions)
        .values({
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          apiVersion: manifest.apiVersion,
          nsfw: manifest.nsfw,
          installedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: extensions.id,
          set: {
            name: manifest.name,
            version: manifest.version,
            apiVersion: manifest.apiVersion,
            nsfw: manifest.nsfw,
            updatedAt: now,
          },
        })
        .run();
      for (const source of manifest.sources) {
        tx.insert(sources)
          .values({
            id: `${manifest.id}/${source.key}`,
            extensionId: manifest.id,
            key: source.key,
            name: source.name,
            lang: source.lang,
          })
          .onConflictDoUpdate({ target: sources.id, set: { name: source.name, lang: source.lang } })
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
