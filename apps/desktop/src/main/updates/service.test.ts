import { AppError, type UpdateStatus } from '@matane-anime/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '../db/__tests__/helpers';
import { RequestRegistry } from '../ipc/requests';
import {
  EXTENSION_VERSIONS_KEY,
  LAST_RUN_KEY,
  type UpdateExtensions,
  UpdateService,
  type UpdateNotification,
} from './service';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => db.close());

const HOUR = 3_600_000;
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

/** The episodes each anime's "source" lists right now; a check syncs them like `ExtensionService` would. */
class Harness {
  log: string[] = [];
  now = 1_000 * HOUR;
  listings = new Map<number, number[]>();
  /** Anime whose refresh fails, and why. */
  failures = new Map<number, string>();
  versions: Record<string, string> = { example: '1.0.0' };
  migratable = true;
  migrations = new Map<string, string>();
  migrationError: Error | null = null;
  focused = false;
  notifications: UpdateNotification[] = [];
  downloaded: number[][] = [];
  autoDownloadError: Error | null = null;
  statuses: UpdateStatus[] = [];
  navigated = 0;
  online = true;
  listeners = new Set<(online: boolean) => void>();
  timers: (() => void)[] = [];
  requests = new RequestRegistry();
  active = 0;
  peak = 0;
  /** When set, each refresh waits for `release()`. */
  hold = false;
  private held: (() => void)[] = [];

  private titles = new Map<number, string>();

  extensions: UpdateExtensions = {
    refreshForUpdate: async (animeId, signal) => {
      this.log.push(`refresh:${this.titles.get(animeId)}`);
      this.active++;
      this.peak = Math.max(this.peak, this.active);
      try {
        if (this.hold) {
          await new Promise<void>((resolve, reject) => {
            this.held.push(resolve);
            signal?.addEventListener('abort', () => reject(new AppError('cancelled', 'cancelled')), { once: true });
          });
        }
        const failure = this.failures.get(animeId);
        if (failure) throw new AppError('extension', failure);
        const numbers = this.listings.get(animeId) ?? [];
        const title = this.titles.get(animeId) as string;
        const result = db.episodes.sync(
          animeId,
          numbers.map((number) => ({ url: `/${title}/${number}`, name: `Episode ${number}`, number })),
          this.now,
        );
        return { addedEpisodeIds: result.addedIds };
      } finally {
        this.active--;
      }
    },
    extensionVersions: () => this.versions,
    supportsMigrateUrl: async () => this.migratable,
    migrateUrl: async (_sourceId, url, kind, fromVersion) => {
      this.log.push(`migrateUrl:${kind}:${fromVersion}`);
      if (this.migrationError) throw this.migrationError;
      return this.migrations.get(url) ?? null;
    },
  };

  release(): void {
    while (this.held.length > 0) this.held.shift()?.();
  }

  service = new UpdateService({
    repo: db.updates,
    settings: db.settings,
    extensions: this.extensions,
    requests: this.requests,
    emitStatus: (status) => void this.statuses.push(status),
    autoDownload: async (ids) => {
      this.log.push('autoDownload');
      if (this.autoDownloadError) throw this.autoDownloadError;
      this.downloaded.push(ids);
    },
    notify: (notification) => {
      this.log.push('notify');
      this.notifications.push(notification);
    },
    navigate: () => void this.navigated++,
    isWindowFocused: () => this.focused,
    systemLocale: () => 'en-US',
    isOnline: () => this.online,
    onOnlineChange: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
    now: () => this.now,
    setTimer: (callback) => {
      this.timers.push(callback);
      return this.timers.length;
    },
    clearTimer: () => undefined,
  });

  /** A library anime that has episodes 1..`known` when added; the source later lists 1..`listed`. */
  anime(title: string, known: number, listed = known, options: { sourceId?: string; status?: string } = {}): number {
    const [row] = db.anime.upsertSummaries(options.sourceId ?? 'example/en', [{ url: `/${title}`, title }]);
    const id = row!.id;
    this.titles.set(id, title);
    db.episodes.sync(
      id,
      Array.from({ length: known }, (_, i) => ({
        url: `/${title}/${known - i}`,
        name: `Episode ${known - i}`,
        number: known - i,
      })),
      100,
    );
    db.library.add(id, [], 500);
    db.connection.sqlite
      .prepare('UPDATE anime SET status = ?, last_update_check_at = 1 WHERE id = ?')
      .run(options.status ?? 'ongoing', id);
    // Started, so the default rules do not skip it.
    db.history.touch(id, db.episodes.list(id)[0]?.id ?? 0, 600);
    this.listings.set(
      id,
      Array.from({ length: listed }, (_, i) => listed - i),
    );
    return id;
  }
}

let h: Harness;
const setup = () => (h = new Harness());

describe('check (UPD-1…2)', () => {
  it('refreshes every library anime, counts the new episodes found this run, and marks each as checked', async () => {
    setup();
    const a = h.anime('Alpha', 2, 4);
    const b = h.anime('Beta', 2, 2);
    const result = await h.service.check({ kind: 'all' });
    expect(result).toEqual({ checked: 2, skipped: 0, newEpisodes: 2, failed: 0 });
    expect(db.anime.get(a)).toMatchObject({ updateCheckedAt: h.now, updateError: null });
    expect(db.anime.get(b)).toMatchObject({ updateCheckedAt: h.now });
    expect(h.service.count()).toBe(2);
    expect(h.service.list().entries.map((e) => e.episodeNumber)).toEqual([4, 3]);
    expect(h.service.list().lastCheckedAt).toBe(h.now);
    // Nothing new the second time, and nothing is counted twice.
    expect(await h.service.check({ kind: 'all' })).toMatchObject({ checked: 2, newEpisodes: 0 });
    expect(h.service.count()).toBe(2);
  });

  it('counts Sub and Dub of one number as one episode', async () => {
    setup();
    const id = h.anime('Alpha', 1);
    const original = h.extensions.refreshForUpdate;
    h.extensions.refreshForUpdate = async (animeId, signal) => {
      await original(animeId, signal);
      const result = db.episodes.sync(
        animeId,
        [
          { url: '/Alpha/2sub', name: 'E2', number: 2, variant: 'Sub' },
          { url: '/Alpha/2dub', name: 'E2', number: 2, variant: 'Dub' },
          { url: '/Alpha/1', name: 'E1', number: 1 },
        ],
        h.now,
      );
      return { addedEpisodeIds: result.addedIds };
    };
    expect(await h.service.check({ kind: 'anime', animeId: id })).toMatchObject({ newEpisodes: 1 });
    expect(h.service.count()).toBe(2);
  });

  it('records a failure per anime and carries on; the next success clears it', async () => {
    setup();
    const bad = h.anime('Bad', 1, 3);
    h.anime('Good', 1, 2);
    h.failures.set(bad, 'HTTP 500');
    const result = await h.service.check({ kind: 'all' });
    expect(result).toEqual({ checked: 1, skipped: 0, newEpisodes: 1, failed: 1 });
    expect(db.anime.get(bad)).toMatchObject({ updateError: 'HTTP 500', updateCheckedAt: null });
    expect(h.service.list().failed).toEqual([expect.objectContaining({ animeId: bad, error: 'HTTP 500' })]);
    h.failures.clear();
    await h.service.check({ kind: 'all' });
    expect(db.anime.get(bad)).toMatchObject({ updateError: null, updateCheckedAt: h.now });
    expect(h.service.list().failed).toEqual([]);
  });

  it('treats an extension that is not installed as an error of that anime, not a crash', async () => {
    setup();
    const lost = h.anime('Lost', 1, 2, { sourceId: 'example/id' });
    h.extensions.refreshForUpdate = async () => {
      throw new AppError('not_found', 'The source "example/id" is not installed');
    };
    await expect(h.service.check({ kind: 'all' })).resolves.toMatchObject({ checked: 0, failed: 1 });
    expect(db.anime.get(lost)!.updateError).toContain('not installed');
  });

  it('checks a category, or a single anime', async () => {
    setup();
    const a = h.anime('Alpha', 1, 2);
    h.anime('Beta', 1, 2);
    const category = db.library.createCategory('Watching');
    db.library.setCategories([a], [category.id]);
    expect(await h.service.check({ kind: 'category', categoryId: category.id })).toMatchObject({ checked: 1 });
    expect(h.log.filter((l) => l.startsWith('refresh'))).toEqual(['refresh:Alpha']);
    await expect(h.service.check({ kind: 'anime', animeId: 999 })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('runs three anime at a time', async () => {
    setup();
    for (let i = 0; i < 7; i++) h.anime(`A${i}`, 1, 2);
    h.hold = true;
    const run = h.service.check({ kind: 'all' });
    await settle();
    expect(h.active).toBe(3);
    while (h.active > 0 || h.peak < 3) {
      h.release();
      await settle();
    }
    h.hold = false;
    h.release();
    await run;
    expect(h.peak).toBe(3);
  });

  it('reports progress, and joins a second library-wide check instead of starting another', async () => {
    setup();
    for (let i = 0; i < 4; i++) h.anime(`A${i}`, 1, 2);
    h.hold = true;
    const first = h.service.check({ kind: 'all' });
    const second = h.service.check({ kind: 'all' });
    await settle();
    h.hold = false;
    h.release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toBe(r2);
    expect(h.log.filter((l) => l.startsWith('refresh'))).toHaveLength(4);
    expect(h.statuses[0]).toEqual({ checking: true, done: 0, total: 4 });
    expect(h.statuses.at(-1)).toEqual({ checking: false, done: 4, total: 4 });
    expect(h.statuses.map((s) => s.done)).toEqual([0, 1, 2, 3, 4, 4]);
  });

  it('can be cancelled with the request id: nothing new starts, no follow-up, no marks on unchecked anime', async () => {
    setup();
    for (let i = 0; i < 6; i++) h.anime(`A${i}`, 1, 2);
    db.settings.updateAppSettings({ autoDownload: true });
    h.hold = true;
    const run = h.service.check({ kind: 'all' }, 'req-1');
    const rejected = expect(run).rejects.toMatchObject({ code: 'cancelled' });
    await settle();
    h.requests.cancel('req-1');
    await rejected;
    expect(h.log.filter((l) => l.startsWith('refresh'))).toHaveLength(3);
    expect(h.log).not.toContain('autoDownload');
    expect(h.log).not.toContain('notify');
    expect(
      db.connection.sqlite.prepare('SELECT COUNT(*) AS n FROM anime WHERE update_error IS NOT NULL').get(),
    ).toEqual({ n: 0 });
    expect(h.statuses.at(-1)?.checking).toBe(false);
  });

  it('a single anime can be checked while a library-wide check runs, and does not touch its progress', async () => {
    setup();
    const a = h.anime('Alpha', 1, 2);
    for (let i = 0; i < 3; i++) h.anime(`B${i}`, 1, 2);
    h.hold = true;
    const all = h.service.check({ kind: 'all' });
    await settle();
    const statusesBefore = h.statuses.length;
    const single = h.service.check({ kind: 'anime', animeId: a });
    await settle();
    h.hold = false;
    h.release();
    await Promise.all([all, single]);
    expect(h.statuses.slice(statusesBefore).every((s) => s.total === 4)).toBe(true);
  });
});

describe('skip rules (UPD-3)', () => {
  it('apply to the library and category checks, not to a single anime', async () => {
    setup();
    const done = h.anime('Done', 2, 3, { status: 'completed' });
    db.library.createCategory('x');
    h.anime('Fresh', 2, 3);
    expect(await h.service.check({ kind: 'all' })).toEqual({ checked: 1, skipped: 1, newEpisodes: 1, failed: 0 });
    expect(db.anime.get(done)!.updateCheckedAt).toBeNull();
    const category = db.library.createCategory('Mine');
    db.library.setCategories([done], [category.id]);
    expect(await h.service.check({ kind: 'category', categoryId: category.id })).toMatchObject({
      checked: 0,
      skipped: 1,
    });
    expect(await h.service.check({ kind: 'anime', animeId: done })).toMatchObject({
      checked: 1,
      skipped: 0,
      newEpisodes: 1,
    });
  });

  it('read the settings: not started, and too many unwatched', async () => {
    setup();
    const untouched = h.anime('Untouched', 2);
    db.history.delete(untouched);
    h.anime('Backlog', 14, 14);
    h.anime('Caught up', 3, 4);
    // Defaults: skip completed, not-started off, more than 10 unwatched.
    expect(await h.service.check({ kind: 'all' })).toMatchObject({ checked: 2, skipped: 1 });
    db.settings.updateAppSettings({ updateSkipNotStarted: true, updateSkipUnwatchedOver: null });
    expect(await h.service.check({ kind: 'all' })).toMatchObject({ checked: 2, skipped: 1 });
    db.settings.updateAppSettings({ updateSkipNotStarted: false });
    expect(await h.service.check({ kind: 'all' })).toMatchObject({ checked: 3, skipped: 0 });
  });
});

describe('after a check (UPD-6)', () => {
  it('runs migrateUrl, then the refresh, then auto-download, then the notification', async () => {
    setup();
    h.anime('Alpha', 1, 2);
    db.settings.updateAppSettings({ autoDownload: true });
    db.settings.setValue(EXTENSION_VERSIONS_KEY, { example: '1.0.0' });
    h.versions = { example: '2.0.0' };
    await h.service.check({ kind: 'all' });
    expect(h.log.filter((l) => !l.startsWith('migrateUrl:episode'))).toEqual([
      'migrateUrl:anime:1.0.0',
      'refresh:Alpha',
      'autoDownload',
      'notify',
    ]);
  });

  it('notifies after auto-download, even when auto-download fails', async () => {
    setup();
    h.anime('Alpha', 1, 2);
    db.settings.updateAppSettings({ autoDownload: true });
    h.autoDownloadError = new Error('disk full');
    await expect(h.service.check({ kind: 'all' })).resolves.toMatchObject({ newEpisodes: 1 });
    expect(h.log).toEqual(['refresh:Alpha', 'autoDownload', 'notify']);
  });

  describe('migrateUrl on a new extension version', () => {
    it('rewrites the urls of anime and episodes, and remembers the version', async () => {
      setup();
      const id = h.anime('Alpha', 2);
      h.migrations.set('/Alpha', '/alpha-v2');
      h.migrations.set('/Alpha/1', '/alpha-v2/1');
      db.settings.setValue(EXTENSION_VERSIONS_KEY, { example: '1.0.0' });
      h.versions = { example: '2.0.0' };
      h.listings.set(id, []);
      await h.service.check({ kind: 'all' });
      expect(db.anime.get(id)!.url).toBe('/alpha-v2');
      expect(
        db.episodes
          .list(id)
          .map((e) => e.url)
          .sort(),
      ).toEqual(['/Alpha/2', '/alpha-v2/1']);
      expect(db.settings.getValue(EXTENSION_VERSIONS_KEY, {})).toEqual({ example: '2.0.0' });
      // The same version again: no second pass.
      h.log.length = 0;
      await h.service.check({ kind: 'all' });
      expect(h.log.some((l) => l.startsWith('migrateUrl'))).toBe(false);
    });

    it('only remembers the version the first time it sees an extension', async () => {
      setup();
      h.anime('Alpha', 1);
      await h.service.check({ kind: 'all' });
      expect(h.log.some((l) => l.startsWith('migrateUrl'))).toBe(false);
      expect(db.settings.getValue(EXTENSION_VERSIONS_KEY, {})).toEqual({ example: '1.0.0' });
    });

    it('passes over an extension without migrateUrl silently', async () => {
      setup();
      h.anime('Alpha', 1);
      h.migratable = false;
      db.settings.setValue(EXTENSION_VERSIONS_KEY, { example: '1.0.0' });
      h.versions = { example: '1.1.0' };
      await expect(h.service.check({ kind: 'all' })).resolves.toMatchObject({ checked: 1 });
      expect(h.log.some((l) => l.startsWith('migrateUrl'))).toBe(false);
      expect(db.settings.getValue(EXTENSION_VERSIONS_KEY, {})).toEqual({ example: '1.1.0' });
    });

    it('tries again at the next check when migrating failed, and the check itself goes on', async () => {
      setup();
      h.anime('Alpha', 1, 2);
      h.migrationError = new Error('host crashed');
      db.settings.setValue(EXTENSION_VERSIONS_KEY, { example: '1.0.0' });
      h.versions = { example: '2.0.0' };
      await expect(h.service.check({ kind: 'all' })).resolves.toMatchObject({ checked: 1, newEpisodes: 1 });
      expect(db.settings.getValue(EXTENSION_VERSIONS_KEY, {})).toEqual({ example: '1.0.0' });
    });

    it('leaves a url alone when another row already has the new one', async () => {
      setup();
      const id = h.anime('Alpha', 1);
      db.anime.upsertSummaries('example/en', [{ url: '/taken', title: 'Taken' }]);
      h.migrations.set('/Alpha', '/taken');
      db.settings.setValue(EXTENSION_VERSIONS_KEY, { example: '1.0.0' });
      h.versions = { example: '2.0.0' };
      await h.service.check({ kind: 'anime', animeId: id });
      expect(db.anime.get(id)!.url).toBe('/Alpha');
    });
  });

  describe('auto-download (DL-11)', () => {
    it('does nothing while the setting is off', async () => {
      setup();
      h.anime('Alpha', 1, 3);
      await h.service.check({ kind: 'all' });
      expect(h.downloaded).toEqual([]);
    });

    it('downloads the new episodes (one per number) when it is on', async () => {
      setup();
      const id = h.anime('Alpha', 1, 3);
      db.settings.updateAppSettings({ autoDownload: true });
      await h.service.check({ kind: 'all' });
      const numbers = h.downloaded.flat().map((episodeId) => db.episodes.get(episodeId)!.number);
      expect(numbers.sort()).toEqual([2, 3]);
      expect(db.episodes.get(h.downloaded[0]![0]!)!.animeId).toBe(id);
    });

    it('skips episodes that already have a download', async () => {
      setup();
      h.anime('Alpha', 1, 3);
      db.settings.updateAppSettings({ autoDownload: true });
      const original = h.extensions.refreshForUpdate;
      h.extensions.refreshForUpdate = async (animeId, signal) => {
        const result = await original(animeId, signal);
        db.connection.sqlite
          .prepare(`INSERT INTO downloads (episode_id, status, kind, created_at) VALUES (?, 'queued', 'hls', 1)`)
          .run(result.addedEpisodeIds[0]);
        return result;
      };
      await h.service.check({ kind: 'all' });
      expect(h.downloaded.flat()).toHaveLength(1);
    });

    it('honours include and exclude per category; exclude always wins', async () => {
      setup();
      const plain = h.anime('Plain', 1, 1);
      const included = h.anime('Included', 1, 1);
      const excluded = h.anime('Excluded', 1, 1);
      const both = h.anime('Both', 1, 1);
      const keep = db.library.createCategory('Keep');
      const skip = db.library.createCategory('Skip');
      db.library.setCategories([included, both], [keep.id]);
      db.library.setCategories([excluded], [skip.id]);
      db.library.setCategories([both], [keep.id, skip.id]);
      db.settings.updateAppSettings({ autoDownload: true });
      const mark = (id: number, mode: string) =>
        db.connection.sqlite
          .prepare('UPDATE categories SET settings_json = ? WHERE id = ?')
          .run(JSON.stringify({ autoDownload: mode }), id);
      const downloadedAnime = async () => {
        h.downloaded.length = 0;
        // A new episode for everyone each round.
        for (const [id, listing] of h.listings) h.listings.set(id, [(listing[0] ?? 0) + 1, ...listing]);
        await h.service.check({ kind: 'all' });
        return h.downloaded
          .flat()
          .map((e) => db.episodes.get(e)!.animeId)
          .sort((a, b) => a - b);
      };
      const all = [plain, included, excluded, both].sort((a, b) => a - b);
      // Nothing marked: everything.
      expect(await downloadedAnime()).toEqual(all);
      // Only an exclude: everything but the excluded (and Both, which is in it).
      mark(skip.id, 'exclude');
      expect(await downloadedAnime()).toEqual([plain, included].sort((a, b) => a - b));
      // An include appears: only included, and exclude still wins for Both.
      mark(keep.id, 'include');
      expect(await downloadedAnime()).toEqual([included]);
    });
  });

  describe('notification (UPD-7)', () => {
    it('is grouped: one for the whole check, with the number of episodes and anime', async () => {
      setup();
      h.anime('Alpha', 1, 4);
      h.anime('Beta', 1, 3);
      h.anime('Gamma', 1, 2);
      await h.service.check({ kind: 'all' });
      expect(h.notifications).toHaveLength(1);
      expect(h.notifications[0]).toMatchObject({ title: 'New episodes', body: '6 new episodes from 3 anime' });
    });

    it('names the anime when it is the only one', async () => {
      setup();
      h.anime('Alpha', 1, 2);
      await h.service.check({ kind: 'all' });
      expect(h.notifications[0]!.body).toBe('1 new episode of Alpha');
    });

    it('follows the language setting', async () => {
      setup();
      h.anime('Alpha', 1, 3);
      h.anime('Beta', 1, 2);
      db.settings.updateAppSettings({ language: 'id' });
      await h.service.check({ kind: 'all' });
      expect(h.notifications[0]).toMatchObject({ title: 'Episode baru', body: '3 episode baru dari 2 anime' });
    });

    it('says nothing when there is nothing new', async () => {
      setup();
      h.anime('Alpha', 2, 2);
      await h.service.check({ kind: 'all' });
      expect(h.notifications).toEqual([]);
    });

    it('is shown for a manual check only when the window is not in front', async () => {
      setup();
      h.anime('Alpha', 1, 2);
      h.focused = true;
      await h.service.check({ kind: 'all' });
      expect(h.notifications).toHaveLength(0);
      h.focused = false;
      h.listings.set(1, [3, 2, 1]);
      await h.service.check({ kind: 'all' });
      expect(h.notifications).toHaveLength(1);
    });

    it('opens Updates when clicked', async () => {
      setup();
      h.anime('Alpha', 1, 2);
      await h.service.check({ kind: 'all' });
      h.notifications[0]!.onClick();
      expect(h.navigated).toBe(1);
    });
  });
});

describe('the schedule (UPD-1)', () => {
  it('runs an automatic check at start when the interval has passed, and always notifies', async () => {
    setup();
    h.anime('Alpha', 1, 2);
    h.focused = true;
    db.settings.setValue(LAST_RUN_KEY, h.now - 13 * HOUR);
    h.service.start();
    await settle();
    expect(h.log).toContain('refresh:Alpha');
    expect(h.notifications).toHaveLength(1);
    expect(db.settings.getValue(LAST_RUN_KEY, null)).toBe(h.now);
    h.service.stop();
  });

  it('does not run before the interval has passed, and waits while offline', async () => {
    setup();
    h.anime('Alpha', 1, 2);
    db.settings.setValue(LAST_RUN_KEY, h.now - 2 * HOUR);
    h.service.start();
    await settle();
    expect(h.log).toEqual([]);
    h.service.stop();

    h.online = false;
    db.settings.setValue(LAST_RUN_KEY, h.now - 20 * HOUR);
    const offline = h.service;
    offline.start();
    await settle();
    expect(h.log).toEqual([]);
    h.online = true;
    for (const listener of h.listeners) listener(true);
    await settle();
    expect(h.log).toContain('refresh:Alpha');
    offline.stop();
  });

  it('is off with an interval of 0', async () => {
    setup();
    h.anime('Alpha', 1, 2);
    db.settings.updateAppSettings({ updateIntervalHours: 0 });
    db.settings.setValue(LAST_RUN_KEY, 0);
    h.service.start();
    await settle();
    expect(h.log).toEqual([]);
    h.service.stop();
  });
});
