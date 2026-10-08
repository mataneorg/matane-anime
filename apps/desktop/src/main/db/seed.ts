import type Database from 'better-sqlite3';

/**
 * Fills the library with `animeCount` anime of `episodesPerAnime` episodes each, half of them with a history
 * entry and some progress. For performance checks only (docs/PRD.md §10.1); never reachable in a packaged app.
 */
export function seedLibrary(sqlite: Database.Database, animeCount: number, episodesPerAnime: number): void {
  const insertAnime = sqlite.prepare(
    "INSERT INTO anime (source_id, url, title, in_library, added_at, status, created_at, updated_at) VALUES ('example/en', ?, ?, 1, ?, 'ongoing', 1, 1)",
  );
  const insertEpisode = sqlite.prepare(
    'INSERT INTO episodes (anime_id, url, name, number, variant, source_order, fetched_at, watched, position_ms, duration_ms) VALUES (?, ?, ?, ?, NULL, ?, 1, ?, ?, 1440000)',
  );
  const insertHistory = sqlite.prepare(
    'INSERT INTO history (anime_id, episode_id, watched_at) VALUES (?, (SELECT id FROM episodes WHERE anime_id = ? AND number = ?), ?)',
  );
  const halfway = Math.floor(episodesPerAnime / 2);
  sqlite.transaction(() => {
    // The anime point at a source row (no foreign key to an extension, so it can stand alone).
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO sources (id, extension_id, key, name, lang) VALUES ('example/en', 'example', 'en', 'Example (EN)', 'en')",
      )
      .run();
    const offset = (sqlite.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM anime').get() as { n: number }).n;
    for (let a = 0; a < animeCount; a++) {
      const n = offset + a;
      const id = Number(insertAnime.run(`/seed${n}`, `Anime number ${n}`, n).lastInsertRowid);
      for (let e = 0; e < episodesPerAnime; e++) {
        insertEpisode.run(
          id,
          `/seed${n}/${e}`,
          `Episode ${e}`,
          episodesPerAnime - e,
          e,
          e > halfway ? 1 : 0,
          e === halfway ? 300_000 : 0,
        );
      }
      if (a % 2 === 0) insertHistory.run(id, id, halfway === 0 ? 1 : episodesPerAnime - halfway, n);
    }
  })();
}
