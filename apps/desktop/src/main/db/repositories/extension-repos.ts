import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { extensionRepos } from '../schema';
import type { ChangeEmitter } from './changes';

export type RepoRow = typeof extensionRepos.$inferSelect;

export interface NewRepo {
  url: string;
  name: string;
  /** Exact text of the accepted `index.json` and `index.json.sig`. */
  indexJson: string;
  signature: string | null;
  /** The key announced in the signature file (not necessarily trusted). */
  signingKey: string | null;
  /** The key the user chose to trust, or null. */
  publicKey: string | null;
  serial: number;
}

export type AcceptedIndex = Pick<NewRepo, 'name' | 'indexJson' | 'signature' | 'signingKey' | 'serial'>;

/**
 * The `extension_repos` table. A repository's accepted index is stored as the exact bytes it was fetched
 * with, so its signature can be checked again at any time. Installed extensions point at their repository
 * with a foreign key that is cleared when the repository is removed.
 */
export class RepoStore {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: ChangeEmitter,
  ) {}

  list(): RepoRow[] {
    return this.db.select().from(extensionRepos).orderBy(extensionRepos.id).all();
  }

  get(id: number): RepoRow | undefined {
    return this.db.select().from(extensionRepos).where(eq(extensionRepos.id, id)).get();
  }

  getByUrl(url: string): RepoRow | undefined {
    return this.db.select().from(extensionRepos).where(eq(extensionRepos.url, url)).get();
  }

  add(repo: NewRepo, now = Date.now()): RepoRow {
    const row = this.db
      .insert(extensionRepos)
      .values({ ...repo, lastFetchedAt: now, lastError: null })
      .returning()
      .get();
    this.changes.emit('repos', 'extensions');
    return row;
  }

  /** Stores a newly accepted index and clears the last error. Trust (`public_key`) is never touched here. */
  saveAccepted(id: number, accepted: AcceptedIndex, now = Date.now()): void {
    this.db
      .update(extensionRepos)
      .set({ ...accepted, lastFetchedAt: now, lastError: null })
      .where(eq(extensionRepos.id, id))
      .run();
    this.changes.emit('repos', 'extensions');
  }

  recordError(id: number, message: string): void {
    this.db
      .update(extensionRepos)
      .set({ lastError: message.slice(0, 500) })
      .where(eq(extensionRepos.id, id))
      .run();
    this.changes.emit('repos');
  }

  setTrustedKey(id: number, publicKey: string | null): void {
    this.db.update(extensionRepos).set({ publicKey }).where(eq(extensionRepos.id, id)).run();
    this.changes.emit('repos', 'extensions');
  }

  /** Installed extensions of this repository stay (their `repo_id` becomes null). */
  remove(id: number): void {
    this.db.delete(extensionRepos).where(eq(extensionRepos.id, id)).run();
    this.changes.emit('repos', 'extensions');
  }
}
