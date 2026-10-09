import type { AutoDownloadMode, Category, ContinueTarget, LibraryItem, LibraryQuery } from '@matane-anime/shared';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { anime, animeCategories, categories, episodes, history } from '../schema';
import type { MigrationPlan } from '../../library/match';
import { type ContinueEpisode, continueTarget } from '../../watch/continue';
import { countEpisodes } from '../../watch/rules';
import type { ChangeEmitter } from './changes';

const MAX_NAME = 50;
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** FTS5 input from what the user typed: each word a prefix, all of them required. */
export function ftsQuery(text: string): string | null {
  const words = text.match(/[\p{L}\p{N}]+/gu);
  return words && words.length > 0 ? words.map((word) => `"${word}"*`).join(' ') : null;
}

interface AnimeRowRaw {
  id: number;
  source_id: string;
  title: string;
  thumbnail_url: string | null;
  cover_path: string | null;
  latest_episode_at: number | null;
  added_at: number | null;
  lang: string | null;
  last_episode_id: number | null;
  watched_at: number | null;
  category_ids: string | null;
}

type EpisodeRaw = [
  id: number,
  animeId: number,
  number: number | null,
  name: string,
  variant: string | null,
  sourceOrder: number,
  watched: number,
  positionMs: number,
  durationMs: number | null,
  sourceMissing: number,
];

interface LibraryEpisode extends ContinueEpisode {
  name: string;
}

/** The auto-download mark in a category's `settings_json`; anything unreadable means "no mark". */
function autoDownloadOf(json: string | null): AutoDownloadMode | null {
  if (!json) return null;
  try {
    const value = (JSON.parse(json) as { autoDownload?: unknown } | null)?.autoDownload;
    return value === 'include' || value === 'exclude' ? value : null;
  } catch {
    return null;
  }
}

/** Categories, library membership and the library list (docs/PRD.md LIB-1…6). */
export class LibraryRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: ChangeEmitter,
  ) {}

  // ------------------------------------------------------------------ categories

  listCategories(): Category[] {
    return (
      this.db.$client
        .prepare(
          `SELECT c.id, c.name, c.sort_order AS sortOrder, c.settings_json AS settingsJson,
                (SELECT COUNT(*) FROM anime_categories ac JOIN anime a ON a.id = ac.anime_id AND a.in_library = 1
                 WHERE ac.category_id = c.id) AS count
         FROM categories c ORDER BY c.sort_order, c.id`,
        )
        .all() as (Omit<Category, 'autoDownload'> & { settingsJson: string | null })[]
    ).map(({ settingsJson, ...category }): Category => ({ ...category, autoDownload: autoDownloadOf(settingsJson) }));
  }

  createCategory(name: string): Category {
    const clean = this.cleanName(name);
    const next =
      (this.db
        .select({ max: sql<number | null>`max(${categories.sortOrder})` })
        .from(categories)
        .get()?.max ?? -1) + 1;
    const row = this.db.insert(categories).values({ name: clean, sortOrder: next }).returning().get();
    this.changes.emit('categories');
    return { id: row.id, name: row.name, sortOrder: row.sortOrder, autoDownload: null, count: 0 };
  }

  renameCategory(id: number, name: string): void {
    this.db
      .update(categories)
      .set({ name: this.cleanName(name) })
      .where(eq(categories.id, id))
      .run();
    this.changes.emit('categories');
  }

  /**
   * Marks a category for auto-download (DL-11) in `categories.settings_json`, keeping any other key in it.
   * `UpdatesRepository.autoDownloadModes` reads the same key.
   */
  setCategoryAutoDownload(id: number, mode: AutoDownloadMode | null): void {
    const row = this.db.select({ json: categories.settingsJson }).from(categories).where(eq(categories.id, id)).get();
    if (!row) return;
    let settings: Record<string, unknown> = {};
    try {
      const parsed: unknown = row.json ? JSON.parse(row.json) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed as Record<string, unknown>;
    } catch {
      // A damaged value is replaced.
    }
    if (mode === null) delete settings['autoDownload'];
    else settings['autoDownload'] = mode;
    const json = Object.keys(settings).length === 0 ? null : JSON.stringify(settings);
    this.db.update(categories).set({ settingsJson: json }).where(eq(categories.id, id)).run();
    this.changes.emit('categories');
  }

  deleteCategory(id: number): void {
    this.db.delete(categories).where(eq(categories.id, id)).run();
    this.changes.emit('categories', 'library');
  }

  /** `ids` is the whole list in its new order. Unknown ids are ignored and missing ones keep their relative place after. */
  reorderCategories(ids: number[]): void {
    this.db.transaction((tx) => {
      const known = tx
        .select({ id: categories.id })
        .from(categories)
        .orderBy(asc(categories.sortOrder), asc(categories.id))
        .all()
        .map((row) => row.id);
      const ordered = [...ids.filter((id) => known.includes(id)), ...known.filter((id) => !ids.includes(id))];
      ordered.forEach((id, index) =>
        tx.update(categories).set({ sortOrder: index }).where(eq(categories.id, id)).run(),
      );
    });
    this.changes.emit('categories');
  }

  private cleanName(name: string): string {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean === '') throw new Error('A category needs a name');
    return clean.slice(0, MAX_NAME);
  }

  // ------------------------------------------------------------------ membership

  /** Puts an anime in the library. `added_at` is set once: it is what "new episode" is measured from (UPD-4). */
  add(animeId: number, categoryIds: number[], now = Date.now()): void {
    this.db.transaction((tx) => {
      const row = tx.select().from(anime).where(eq(anime.id, animeId)).get();
      if (!row) throw new Error(`No anime ${animeId}`);
      tx.update(anime)
        .set({ inLibrary: true, addedAt: row.addedAt ?? now, updatedAt: now })
        .where(eq(anime.id, animeId))
        .run();
      this.replaceCategories(tx, [animeId], categoryIds);
    });
    this.changes.emit('library', 'categories', `anime:${animeId}`);
  }

  remove(animeId: number, now = Date.now()): void {
    this.db.transaction((tx) => {
      tx.update(anime).set({ inLibrary: false, addedAt: null, updatedAt: now }).where(eq(anime.id, animeId)).run();
      tx.delete(animeCategories).where(eq(animeCategories.animeId, animeId)).run();
    });
    this.changes.emit('library', 'categories', `anime:${animeId}`);
  }

  setCategories(animeIds: number[], categoryIds: number[]): void {
    this.db.transaction((tx) => this.replaceCategories(tx, animeIds, categoryIds));
    this.changes.emit('library', 'categories', ...animeIds.map((id) => `anime:${id}`));
  }

  categoryIdsOf(animeId: number): number[] {
    return this.db
      .select({ id: animeCategories.categoryId })
      .from(animeCategories)
      .where(eq(animeCategories.animeId, animeId))
      .all()
      .map((row) => row.id);
  }

  private replaceCategories(
    tx: Pick<AppDatabase, 'select' | 'delete' | 'insert'>,
    animeIds: number[],
    categoryIds: number[],
  ): void {
    if (animeIds.length === 0) return;
    const valid =
      categoryIds.length > 0
        ? tx
            .select({ id: categories.id })
            .from(categories)
            .where(inArray(categories.id, categoryIds))
            .all()
            .map((row) => row.id)
        : [];
    tx.delete(animeCategories).where(inArray(animeCategories.animeId, animeIds)).run();
    for (const animeId of animeIds) {
      for (const categoryId of valid) tx.insert(animeCategories).values({ animeId, categoryId }).run();
    }
  }

  count(): number {
    return (this.db.$client.prepare('SELECT COUNT(*) AS n FROM anime WHERE in_library = 1').get() as { n: number }).n;
  }

  /** Anime in the library that sit in no category: the "Default" tab. */
  uncategorizedCount(): number {
    return (
      this.db.$client
        .prepare(
          `SELECT COUNT(*) AS n FROM anime a
           WHERE a.in_library = 1 AND NOT EXISTS (SELECT 1 FROM anime_categories ac WHERE ac.anime_id = a.id)`,
        )
        .get() as { n: number }
    ).n;
  }

  // ------------------------------------------------------------------ migration (BRW-8)

  /**
   * Moves an anime's place in the library to another anime (the same series on another source), in one
   * transaction: the progress in `plan`, the history entry, the categories, the date it was added and its custom
   * cover. The old rows stay as an ordinary cache entry (and keep their watch sessions); they just leave the
   * library. Returns how many episodes carried progress.
   */
  migrate(fromAnimeId: number, toAnimeId: number, plan: MigrationPlan, now = Date.now()): number {
    let carried = 0;
    this.db.transaction((tx) => {
      const from = tx.select().from(anime).where(eq(anime.id, fromAnimeId)).get();
      const to = tx.select().from(anime).where(eq(anime.id, toAnimeId)).get();
      if (!from || !to) throw new Error('Both anime must exist to migrate');

      for (const transfer of plan.transfers) {
        tx.update(episodes)
          .set({
            watched: transfer.state.watched,
            watchedAt: transfer.state.watchedAt,
            positionMs: transfer.state.positionMs,
            ...(transfer.state.durationMs !== null && { durationMs: transfer.state.durationMs }),
          })
          .where(eq(episodes.id, transfer.to))
          .run();
        carried += transfer.from.length;
      }

      const lastWatched = tx.select().from(history).where(eq(history.animeId, fromAnimeId)).get();
      if (lastWatched) {
        const target = plan.transfers.find((transfer) => transfer.from.includes(lastWatched.episodeId));
        const existing = tx.select().from(history).where(eq(history.animeId, toAnimeId)).get();
        if (target && (!existing || existing.watchedAt < lastWatched.watchedAt)) {
          tx.insert(history)
            .values({ animeId: toAnimeId, episodeId: target.to, watchedAt: lastWatched.watchedAt })
            .onConflictDoUpdate({
              target: history.animeId,
              set: { episodeId: target.to, watchedAt: lastWatched.watchedAt },
            })
            .run();
        }
        tx.delete(history).where(eq(history.animeId, fromAnimeId)).run();
      }

      const categoryIds = [
        ...new Set([
          ...tx
            .select({ id: animeCategories.categoryId })
            .from(animeCategories)
            .where(eq(animeCategories.animeId, fromAnimeId))
            .all()
            .map((row) => row.id),
          ...tx
            .select({ id: animeCategories.categoryId })
            .from(animeCategories)
            .where(eq(animeCategories.animeId, toAnimeId))
            .all()
            .map((row) => row.id),
        ]),
      ];
      tx.delete(animeCategories)
        .where(inArray(animeCategories.animeId, [fromAnimeId, toAnimeId]))
        .run();
      for (const categoryId of categoryIds) tx.insert(animeCategories).values({ animeId: toAnimeId, categoryId }).run();

      // The new anime inherits the old date added, so the episodes it already has would all look new (UPD-4,
      // they were fetched after that date). They are what the user had, not updates: pull them back to it.
      const addedAt = from.addedAt ?? to.addedAt ?? now;
      tx.update(episodes)
        .set({ fetchedAt: addedAt })
        .where(and(eq(episodes.animeId, toAnimeId), gt(episodes.fetchedAt, addedAt)))
        .run();
      tx.update(anime)
        .set({
          inLibrary: true,
          addedAt,
          customCoverPath: from.customCoverPath ?? to.customCoverPath,
          updatedAt: now,
        })
        .where(eq(anime.id, toAnimeId))
        .run();
      tx.update(anime).set({ inLibrary: false, addedAt: null, updatedAt: now }).where(eq(anime.id, fromAnimeId)).run();
    });
    this.changes.emit(
      'library',
      'categories',
      'history',
      `anime:${fromAnimeId}`,
      `anime:${toAnimeId}`,
      `episodes:${toAnimeId}`,
    );
    return carried;
  }

  // ------------------------------------------------------------------ the list

  /**
   * The library as the grid shows it. Two queries, then the same functions the detail page uses (counts per
   * number, "continue" target), so a card and the page it opens can never disagree.
   */
  list(query: LibraryQuery, thresholdPercent: number): LibraryItem[] {
    const where = ['a.in_library = 1'];
    const params: (string | number)[] = [];
    if (query.category !== undefined) {
      where.push('EXISTS (SELECT 1 FROM anime_categories ac WHERE ac.anime_id = a.id AND ac.category_id = ?)');
      params.push(query.category);
    } else if (query.uncategorized) {
      where.push('NOT EXISTS (SELECT 1 FROM anime_categories ac WHERE ac.anime_id = a.id)');
    }
    const match = query.search ? ftsQuery(query.search) : null;
    if (match) {
      where.push('a.id IN (SELECT rowid FROM anime_fts WHERE anime_fts MATCH ?)');
      params.push(match);
    }
    if (query.status && query.status.length > 0) {
      where.push(`a.status IN (${query.status.map(() => '?').join(', ')})`);
      params.push(...query.status);
    }
    if (query.sourceIds && query.sourceIds.length > 0) {
      where.push(`a.source_id IN (${query.sourceIds.map(() => '?').join(', ')})`);
      params.push(...query.sourceIds);
    }
    if (query.downloadedOnly) {
      where.push(
        `EXISTS (SELECT 1 FROM downloads d JOIN episodes e ON e.id = d.episode_id
                 WHERE e.anime_id = a.id AND d.status = 'done')`,
      );
    }

    const rows = this.db.$client
      .prepare(
        `SELECT a.id, a.source_id, a.title, a.thumbnail_url, a.cover_path, a.latest_episode_at, a.added_at,
                s.lang AS lang, h.episode_id AS last_episode_id, h.watched_at AS watched_at,
                (SELECT group_concat(category_id) FROM anime_categories ac WHERE ac.anime_id = a.id) AS category_ids
         FROM anime a
         LEFT JOIN sources s ON s.id = a.source_id
         LEFT JOIN history h ON h.anime_id = a.id
         WHERE ${where.join(' AND ')}`,
      )
      .all(...params) as AnimeRowRaw[];
    if (rows.length === 0) return [];

    const episodesByAnime = new Map<number, LibraryEpisode[]>();
    const episodeRows = this.db.$client
      .prepare(
        `SELECT id, anime_id, number, name, variant, source_order, watched, position_ms, duration_ms, source_missing
         FROM episodes WHERE anime_id IN (SELECT id FROM anime WHERE in_library = 1)`,
      )
      .raw(true)
      .all() as EpisodeRaw[];
    for (const [
      id,
      animeId,
      number,
      name,
      variant,
      sourceOrder,
      watched,
      positionMs,
      durationMs,
      sourceMissing,
    ] of episodeRows) {
      let list = episodesByAnime.get(animeId);
      if (!list) episodesByAnime.set(animeId, (list = []));
      list.push({
        id,
        number,
        name,
        variant,
        sourceOrder,
        watched: watched === 1,
        positionMs,
        durationMs,
        sourceMissing: sourceMissing === 1,
      });
    }

    let items = rows.map((row): LibraryItem => {
      const episodes = episodesByAnime.get(row.id) ?? [];
      const { total, unwatched } = countEpisodes(episodes);
      const last =
        row.last_episode_id === null ? undefined : episodes.find((episode) => episode.id === row.last_episode_id);
      const target = continueTarget(episodes, row.last_episode_id, thresholdPercent);
      return {
        animeId: row.id,
        sourceId: row.source_id,
        lang: row.lang,
        title: row.title,
        thumbnailUrl: row.thumbnail_url,
        hasLocalCover: row.cover_path !== null,
        categoryIds: row.category_ids ? row.category_ids.split(',').map(Number) : [],
        total,
        unwatched,
        lastEpisode: last
          ? {
              episodeId: last.id,
              number: last.number,
              name: last.name,
              positionMs: last.positionMs,
              durationMs: last.durationMs,
              watched: last.watched,
            }
          : null,
        lastWatchedAt: row.watched_at,
        latestEpisodeAt: row.latest_episode_at,
        addedAt: row.added_at,
        continue: target ? toDto(target) : null,
      };
    });

    if (query.unwatchedOnly) items = items.filter((item) => item.unwatched > 0);
    if (query.startedOnly) {
      items = items.filter(
        (item) =>
          item.lastWatchedAt !== null ||
          (episodesByAnime.get(item.animeId) ?? []).some((e) => e.watched || e.positionMs > 0),
      );
    }
    return sortItems(items, query);
  }
}

function toDto(target: {
  episode: LibraryEpisode;
  reason: ContinueTarget['reason'];
  resumeMs: number;
}): ContinueTarget {
  return {
    episodeId: target.episode.id,
    number: target.episode.number,
    name: target.episode.name,
    reason: target.reason,
    resumeMs: target.resumeMs,
  };
}

function sortItems(items: LibraryItem[], query: LibraryQuery): LibraryItem[] {
  const newestFirst = (a: number | null, b: number | null): number => (b ?? -Infinity) - (a ?? -Infinity) || 0;
  const compare: Record<LibraryQuery['sort'], (a: LibraryItem, b: LibraryItem) => number> = {
    title: (a, b) => collator.compare(a.title, b.title),
    lastWatched: (a, b) => newestFirst(a.lastWatchedAt, b.lastWatchedAt),
    latestEpisode: (a, b) => newestFirst(a.latestEpisodeAt, b.latestEpisodeAt),
    added: (a, b) => newestFirst(a.addedAt, b.addedAt),
    unwatched: (a, b) => b.unwatched - a.unwatched,
  };
  const direction = query.descending ? -1 : 1;
  return [...items].sort((a, b) => direction * (compare[query.sort](a, b) || collator.compare(a.title, b.title)));
}
