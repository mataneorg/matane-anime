import type { ExtensionManifest } from '@matane-anime/extension-sdk/manifest';
import { AppError } from '@matane-anime/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
afterEach(() => db.close());

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
