import { resolve } from 'node:path';
import { ExtensionRuntime } from '@matane-anime/extension-runtime';
import { TestSite } from '@matane-anime/test-site';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb, manifest } from '../db/__tests__/helpers';
import { ExtensionService } from '../extensions/service';
import type { ExtensionHostClient } from '../extensions/host-client';
import type { ExtensionRegistry } from '../extensions/registry';
import { RequestRegistry } from '../ipc/requests';
import type { NetworkManager } from '../network/manager';
import { type UpdateNotification, UpdateService } from './service';

// The whole path of an update, without Electron: the fake site (`TestSite`) lists more episodes, a real
// `ExtensionService` asks a real extension (QuickJS) for them, the checker finds them, and the Updates list,
// the badge, the notification and the auto-download hook follow. Only the extension host process is replaced
// (by running the sandbox in this process), and the network layer by Node's `fetch`.

const MEDIA = resolve(__dirname, '../../../e2e/fixtures/media');
let site: TestSite;
let db: TestDb;
let runtime: ExtensionRuntime;
let updates: UpdateService;
let extensions: ExtensionService;
const notifications: UpdateNotification[] = [];
const downloaded: number[][] = [];

beforeAll(async () => {
  site = await TestSite.start({ mediaDir: MEDIA, challengeMs: 20 });
  runtime = await ExtensionRuntime.create({
    manifest,
    hostInfo: { appName: 'test', appVersion: '0.0.0', apiVersion: 1 },
    host: {
      http: async (request) => {
        const response = await fetch(request.url, {
          method: request.method ?? 'GET',
          headers: request.headers ?? {},
        });
        return {
          status: response.status,
          url: response.url,
          headers: Object.fromEntries(response.headers),
          text: await response.text(),
        };
      },
      storage: { get: async () => null, set: async () => undefined, remove: async () => undefined },
      log: () => undefined,
    },
    // The extension a site author would write: an anime page and an episode list as JSON.
    code: `
      globalThis.__extension = {
        createSource(info) {
          return {
            baseUrl: ${JSON.stringify(site.origin)},
            info,
            getAnimeDetails(anime) { return { url: anime.url, title: anime.title, status: 'ongoing' }; },
            async getEpisodes(anime) {
              const response = await http.get(this.baseUrl + anime.url + '/episodes.json');
              return response.json().episodes.map((e) => ({
                url: '/watch/' + anime.url.split('/').pop() + '/' + e.number + '?variant=' + e.variant,
                name: e.title, number: e.number, variant: e.variant, uploadedAt: e.uploadedAt,
              }));
            },
          };
        },
      };`,
  });
});

afterAll(async () => {
  runtime.dispose();
  await site.close();
});

beforeEach(async () => {
  site.reset();
  notifications.length = 0;
  downloaded.length = 0;
  db = await createTestDb();
  const registry = {
    byExtensionId: () => ({ manifest, status: 'ready', preferences: [] }),
    ensureLoaded: async () => undefined,
    markUnloaded: () => undefined,
    list: () => [{ id: 'example', status: 'ready', version: manifest.version }],
  } as unknown as ExtensionRegistry;
  const host = {
    send: async (command: { type: string; sourceKey: string; method: string; args: unknown[] }) => {
      if (command.type === 'call') return runtime.call(command.sourceKey, command.method, command.args);
      if (command.type === 'supports') return runtime.supports(command.sourceKey, command.method);
      return runtime.preferences();
    },
  } as unknown as ExtensionHostClient;
  extensions = new ExtensionService({
    registry,
    host,
    store: db.store,
    settings: db.settings,
    anime: db.anime,
    episodes: db.episodes,
    network: { status: { isOnline: true } } as unknown as NetworkManager,
    requests: new RequestRegistry(),
    categoryIdsOf: (animeId) => db.library.categoryIdsOf(animeId),
  });
  updates = new UpdateService({
    repo: db.updates,
    settings: db.settings,
    extensions,
    requests: new RequestRegistry(),
    emitStatus: () => undefined,
    autoDownload: async (ids) => void downloaded.push(ids),
    notify: (notification) => void notifications.push(notification),
    navigate: () => undefined,
    isWindowFocused: () => false,
    systemLocale: () => 'en-US',
    isOnline: () => true,
    onOnlineChange: () => () => undefined,
  });
});

afterEach(() => db.close());

const pause = () => new Promise((resolve) => setTimeout(resolve, 10));

/** What the user does: open the detail page (a refresh), then add the anime to the library. */
async function addToLibrary(slug: string, title: string, categoryIds: number[] = []): Promise<number> {
  const [row] = db.anime.upsertSummaries('example/en', [{ url: `/anime/${slug}`, title }]);
  await extensions.refresh(row!.id);
  await pause();
  db.library.add(row!.id, categoryIds);
  await pause();
  return row!.id;
}

describe('UpdateService against the fake site', () => {
  it('finds nothing at first, then the episodes the site gets, and drops them as they are watched', async () => {
    const orchard = await addToLibrary('quiet-orchard', 'Quiet Orchard');
    expect(db.episodes.list(orchard)).toHaveLength(3);
    // What the site had when the anime was added is not news.
    expect(await updates.check({ kind: 'all' })).toEqual({ checked: 1, skipped: 0, newEpisodes: 0, failed: 0 });
    expect(updates.count()).toBe(0);
    expect(notifications).toHaveLength(0);

    site.setEpisodeCount('quiet-orchard', 5);
    expect(await updates.check({ kind: 'all' })).toEqual({ checked: 1, skipped: 0, newEpisodes: 2, failed: 0 });
    expect(updates.count()).toBe(2);
    expect(updates.list().entries.map((e) => [e.animeTitle, e.episodeNumber])).toEqual([
      ['Quiet Orchard', 5],
      ['Quiet Orchard', 4],
    ]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.body).toBe('2 new episodes of Quiet Orchard');

    // The same list again finds nothing more, and does not notify again.
    expect(await updates.check({ kind: 'all' })).toMatchObject({ newEpisodes: 0 });
    expect(notifications).toHaveLength(1);

    // Watching goes through the watch path (`setWatched` here), and the entry leaves the list.
    const five = db.episodes.list(orchard).find((e) => e.number === 5)!;
    db.episodes.setWatched([five.id], true);
    expect(updates.list().entries.map((e) => e.episodeNumber)).toEqual([4]);
    expect(updates.count()).toBe(1);
  });

  it('counts Sub and Dub of a new number once, and lists both', async () => {
    await addToLibrary('two-voices', 'Two Voices');
    site.setEpisodeCount('two-voices', 7);
    expect(await updates.check({ kind: 'all' })).toMatchObject({ checked: 1, newEpisodes: 1 });
    expect(
      updates
        .list()
        .entries.map((e) => [e.episodeNumber, e.variant])
        .sort(),
    ).toEqual([
      [7, 'Dub'],
      [7, 'Sub'],
    ]);
    expect(notifications[0]!.body).toBe('1 new episode of Two Voices');
  });

  it('auto-downloads one copy of each new episode, only for anime in an included category', async () => {
    const keep = db.library.createCategory('Keep');
    db.connection.sqlite
      .prepare('UPDATE categories SET settings_json = ? WHERE id = ?')
      .run(JSON.stringify({ autoDownload: 'include' }), keep.id);
    const included = await addToLibrary('two-voices', 'Two Voices', [keep.id]);
    await addToLibrary('quiet-orchard', 'Quiet Orchard');
    db.settings.updateAppSettings({ autoDownload: true });
    site.setEpisodeCount('two-voices', 7);
    site.setEpisodeCount('quiet-orchard', 4);
    await updates.check({ kind: 'all' });
    expect(downloaded).toHaveLength(1);
    const rows = downloaded[0]!.map((id) => db.episodes.get(id)!);
    expect(rows.map((row) => [row.animeId, row.number])).toEqual([[included, 7]]);
    expect(notifications[0]!.body).toBe('2 new episodes from 2 anime');
  });

  it('records a site that is down per anime, and clears it when the site is back', async () => {
    const orchard = await addToLibrary('quiet-orchard', 'Quiet Orchard');
    await site.stop();
    const down = await updates.check({ kind: 'all' });
    expect(down).toMatchObject({ checked: 0, failed: 1 });
    expect(db.anime.get(orchard)!.updateError).not.toBeNull();
    expect(updates.list().failed).toHaveLength(1);
    // Nothing was lost: the episodes are still there.
    expect(db.episodes.list(orchard)).toHaveLength(3);

    await site.resume();
    site.setEpisodeCount('quiet-orchard', 4);
    expect(await updates.check({ kind: 'anime', animeId: orchard })).toMatchObject({ checked: 1, newEpisodes: 1 });
    expect(db.anime.get(orchard)!.updateError).toBeNull();
    expect(updates.list().failed).toEqual([]);
  });

  it('keeps what was watched when the site drops episodes, and deletes the rest (UPD-5)', async () => {
    const orchard = await addToLibrary('quiet-orchard', 'Quiet Orchard');
    site.setEpisodeCount('quiet-orchard', 5);
    await updates.check({ kind: 'all' });
    const numbers = () =>
      db.episodes
        .list(orchard)
        .map((e) => [e.number, e.sourceMissing] as const)
        .sort((a, b) => b[0]! - a[0]!);
    db.episodes.setWatched([db.episodes.list(orchard).find((e) => e.number === 5)!.id], true);

    site.setEpisodeCount('quiet-orchard', 3);
    await updates.check({ kind: 'all' });
    expect(numbers()).toEqual([
      [5, true],
      [3, false],
      [2, false],
      [1, false],
    ]);
    // An empty answer from the site (a page that failed to render) deletes nothing.
    site.setEpisodeCount('quiet-orchard', 0);
    await updates.check({ kind: 'all' });
    expect(db.episodes.list(orchard)).toHaveLength(4);
  });
});
