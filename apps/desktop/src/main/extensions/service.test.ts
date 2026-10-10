import type { ExtensionManifest } from '@matane-anime/extension-sdk/manifest';
import { AppError } from '@matane-anime/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type TestDb, createTestDb } from '../db/__tests__/helpers';
import { RequestRegistry } from '../ipc/requests';
import type { NetworkManager } from '../network/manager';
import type { ExtensionHostClient } from './host-client';
import type { ExtensionRegistry } from './registry';
import { manifestFor } from './repo-test-helpers';
import { ExtensionService } from './service';

// EXT-15 in main: which sources are listed, and which can be browsed.

let db: TestDb;
let service: ExtensionService;
let calls: string[];
/** Held by a test to keep `getStreams` from answering yet. */
let streamsGate: Promise<void> | null = null;
const manifests = new Map<string, ExtensionManifest>();

const adult = manifestFor('adult', { nsfw: true, sources: [{ key: 'en', lang: 'en', name: 'Adult (EN)' }] });
const multi = manifestFor('multi', { sources: [{ key: 'all', lang: 'multi', name: 'Multi' }] });
const indo = manifestFor('indo', {
  sources: [
    { key: 'id', lang: 'id', name: 'Indo' },
    { key: 'en', lang: 'en', name: 'Indo (EN)' },
  ],
});

beforeEach(async () => {
  db = await createTestDb();
  calls = [];
  streamsGate = null;
  manifests.clear();
  for (const manifest of [adult, multi, indo]) {
    manifests.set(manifest.id, manifest);
    db.store.upsertExtension(manifest, 1);
  }
  const registry = {
    byExtensionId: (id: string) => {
      const manifest = manifests.get(id);
      return manifest && { manifest, status: 'ready', preferences: [] };
    },
    ensureLoaded: async () => undefined,
    markUnloaded: () => undefined,
  } as unknown as ExtensionRegistry;
  const host = {
    send: async (command: { type: string; method?: string }) => {
      calls.push(`${command.type}:${command.method ?? ''}`);
      if (command.type === 'call' && command.method === 'getStreams') {
        await streamsGate;
        return [{ url: 'https://cdn.test/a.m3u8', server: 'Server A', kind: 'hls' }];
      }
      if (command.type === 'call') return { items: [], hasNextPage: false };
      return undefined;
    },
  } as unknown as ExtensionHostClient;
  service = new ExtensionService({
    registry,
    host,
    store: db.store,
    settings: db.settings,
    anime: db.anime,
    episodes: db.episodes,
    network: { status: { isOnline: true } } as unknown as NetworkManager,
    requests: new RequestRegistry(),
    categoryIdsOf: () => [],
  });
});
afterEach(() => {
  vi.useRealTimers();
  db.close();
});

const ids = () => service.listSources().map((source) => source.id);

describe('sources.list', () => {
  it('hides 18+ sources unless showNsfw is on', () => {
    expect(ids()).toEqual(expect.not.arrayContaining(['adult/en']));
    expect(ids().sort()).toEqual(['example/en', 'example/id', 'indo/en', 'indo/id', 'multi/all']);
    db.settings.updateAppSettings({ showNsfw: true });
    expect(ids()).toContain('adult/en');
    expect(service.listSources().find((source) => source.id === 'adult/en')).toMatchObject({ nsfw: true });
  });

  it('keeps only the chosen languages, and multi always', () => {
    db.settings.updateAppSettings({ contentLanguages: ['id'] });
    expect(ids().sort()).toEqual(['example/id', 'indo/id', 'multi/all']);
    db.settings.updateAppSettings({ contentLanguages: ['id', 'en'] });
    expect(ids().sort()).toEqual(['example/en', 'example/id', 'indo/en', 'indo/id', 'multi/all']);
    db.settings.updateAppSettings({ contentLanguages: [], showNsfw: true });
    expect(ids()).toHaveLength(6);
  });

  it('still knows the 18+ flag of an extension that is no longer installed', () => {
    manifests.delete('adult');
    expect(ids()).not.toContain('adult/en');
    db.settings.updateAppSettings({ showNsfw: true });
    expect(service.listSources().find((source) => source.id === 'adult/en')).toMatchObject({
      nsfw: true,
      available: false,
    });
  });
});

describe('browsing an 18+ source', () => {
  const rejected = async (work: Promise<unknown>) => {
    try {
      await work;
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('forbidden');
      return;
    }
    throw new Error('expected forbidden');
  };

  it('is forbidden while showNsfw is off, for browse, search, filters and resolveUrl, and never reaches the extension', async () => {
    await rejected(service.browse({ sourceId: 'adult/en', kind: 'popular', page: 1 }));
    await rejected(service.browse({ sourceId: 'adult/en', kind: 'search', page: 1, query: 'x' }));
    await rejected(service.filters('adult/en'));
    await rejected(service.resolveUrl('adult/en', 'https://x.test/a'));
    expect(calls).toEqual([]);
  });

  it('works once showNsfw is on', async () => {
    db.settings.updateAppSettings({ showNsfw: true });
    await expect(service.browse({ sourceId: 'adult/en', kind: 'popular', page: 1 })).resolves.toEqual({
      items: [],
      hasNextPage: false,
    });
    expect(calls).toContain('call:getPopular');
  });

  it('does not stop a normal source, whatever the language setting is', async () => {
    db.settings.updateAppSettings({ contentLanguages: ['ja'] });
    await expect(service.browse({ sourceId: 'indo/id', kind: 'popular', page: 1 })).resolves.toMatchObject({
      hasNextPage: false,
    });
  });
});

describe('streams kept in memory (STR-6)', () => {
  const asked = (): number => calls.filter((call) => call === 'call:getStreams').length;
  const episodeOf = (n: number) => {
    const [row] = db.anime.upsertSummaries('indo/id', [{ url: '/a', title: 'Anime' }]);
    db.episodes.sync(
      row!.id,
      [1, 2, 3].map((number) => ({ url: `/a/${number}`, name: `Episode ${number}`, number })),
      100,
    );
    return { row: row!, episode: db.episodes.list(row!.id).find((episode) => episode.number === n)! };
  };

  it('asks the extension once, then answers from memory', async () => {
    const { row, episode } = episodeOf(1);
    expect(service.hasCachedStreams(row, episode)).toBe(false);
    const first = await service.streamsFor(row, episode, false);
    expect(first).toHaveLength(1);
    expect(service.hasCachedStreams(row, episode)).toBe(true);
    await service.streamsFor(row, episode, false);
    expect(asked()).toBe(1);
  });

  it('keeps them for 24 hours and not longer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
    const { row, episode } = episodeOf(1);
    await service.streamsFor(row, episode, false);
    vi.setSystemTime(new Date('2026-10-11T09:59:00Z'));
    expect(service.hasCachedStreams(row, episode)).toBe(true);
    await service.streamsFor(row, episode, false);
    expect(asked()).toBe(1);
    vi.setSystemTime(new Date('2026-10-11T10:01:00Z'));
    expect(service.hasCachedStreams(row, episode)).toBe(false);
    await service.streamsFor(row, episode, false);
    expect(asked()).toBe(2);
  });

  it('`fresh` skips the memory and replaces what is in it', async () => {
    const { row, episode } = episodeOf(1);
    await service.streamsFor(row, episode, false);
    await service.streamsFor(row, episode, true);
    expect(asked()).toBe(2);
    await service.streamsFor(row, episode, false);
    expect(asked()).toBe(2);
  });

  it('shares one call between a prefetch and a click that arrives while it runs', async () => {
    let release!: () => void;
    streamsGate = new Promise<void>((resolve) => (release = resolve));
    const { row, episode } = episodeOf(2);
    const prefetch = service.streamsFor(row, episode, false);
    const click = service.streamsFor(row, episode, false);
    release();
    expect(await click).toEqual(await prefetch);
    expect(asked()).toBe(1);
  });

  it('keeps episodes apart', async () => {
    const one = episodeOf(1);
    const two = episodeOf(2);
    await service.streamsFor(one.row, one.episode, false);
    expect(service.hasCachedStreams(two.row, two.episode)).toBe(false);
  });
});
