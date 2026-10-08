import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb, manifest } from './helpers';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => db.close());

const sql = (text: string, ...params: unknown[]) => db.connection.sqlite.prepare(text).run(...params);
const one = <T>(text: string, ...params: unknown[]) => db.connection.sqlite.prepare(text).get(...params) as T;

describe('extension repositories (migration 0004)', () => {
  it('starts an extension as a dev one, without an install folder or a hash', () => {
    expect(one('SELECT origin, install_dir AS installDir, sha256 FROM extensions WHERE id = ?', 'example')).toEqual({
      origin: 'dev',
      installDir: null,
      sha256: null,
    });
  });

  it('stores a repository with the announced key apart from the trusted one, and a serial', () => {
    sql(
      `INSERT INTO extension_repos (url, name, signing_key, serial) VALUES ('https://r.test/', 'R', 'ed25519:aa', 3)`,
    );
    expect(one('SELECT public_key AS trusted, signing_key AS announced, serial FROM extension_repos')).toEqual({
      trusted: null,
      announced: 'ed25519:aa',
      serial: 3,
    });
    sql(`INSERT INTO extension_repos (url) VALUES ('https://other.test/')`);
    expect(one('SELECT serial FROM extension_repos WHERE url = ?', 'https://other.test/')).toEqual({ serial: 0 });
  });

  it('keeps an installed extension when its repository is removed', () => {
    sql(`INSERT INTO extension_repos (id, url) VALUES (7, 'https://r.test/')`);
    sql(`UPDATE extensions SET repo_id = 7, origin = 'repo', install_dir = '/x/example' WHERE id = 'example'`);
    sql('DELETE FROM extension_repos WHERE id = 7');
    expect(one('SELECT origin, repo_id AS repoId FROM extensions WHERE id = ?', 'example')).toEqual({
      origin: 'repo',
      repoId: null,
    });
  });
});

describe('the 18+ flag of a source (migration 0005)', () => {
  it('is kept with the source when the extension is deleted, and follows the manifest on every load', () => {
    const adult = { ...manifest, id: 'adult', nsfw: true, sources: [{ key: 'en', lang: 'en', name: 'Adult (EN)' }] };
    db.store.upsertExtension(adult, 2000);
    expect(db.store.getSource('adult/en')?.nsfw).toBe(true);
    expect(db.store.getSource('example/en')?.nsfw).toBe(false);

    db.store.deleteExtension('adult');
    expect(db.store.getExtension('adult')).toBeUndefined();
    expect(db.store.getSource('adult/en')?.nsfw).toBe(true);

    db.store.upsertExtension({ ...adult, nsfw: false }, 3000);
    expect(db.store.getSource('adult/en')?.nsfw).toBe(false);
  });
});
