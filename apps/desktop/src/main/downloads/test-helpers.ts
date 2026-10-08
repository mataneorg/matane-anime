import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Stream } from '@matane-anime/extension-sdk';
import type { DownloadProgress } from '@matane-anime/shared';
import type { TestSite } from '@matane-anime/test-site';
import { type TestDb, createTestDb } from '../db/__tests__/helpers';
import type { DownloadUpstream } from './fetch';
import { DownloadService, type DownloadServiceDeps } from './service';

// Shared by the engine's tests: a real database, a download folder in the temp dir, a switchable network, and
// streams that look like an extension's (the fake site's embeds, or plain URLs).

export const MEDIA_DIR = join(__dirname, '../../../e2e/fixtures/media');

/** What an extension does with an embed: ask for the page and read the player config out of it. */
export async function embedStream(site: TestSite, slug: string, number = 1, side: 'a' = 'a'): Promise<Stream> {
  const response = await fetch(`${site.origin}/embed/${slug}-${number}-sub.${side}`, {
    headers: { Referer: site.referer },
  });
  const html = await response.text();
  const config = /window\.player = (\{.*\});/.exec(html)?.[1];
  if (!config) throw new Error(`No player config in the embed of ${slug}: ${html.slice(0, 100)}`);
  const source = (JSON.parse(config) as { sources: { file: string; label: string }[] }).sources[0]!;
  return {
    url: source.file,
    server: 'Server A',
    quality: Number.parseInt(source.label, 10) || undefined,
    headers: { Referer: site.referer },
  } as Stream;
}

/** A stream at a known path of the media host. */
export const cdnStream = (site: TestSite, path: string, extra: Partial<Stream> = {}): Stream => ({
  url: `${site.cdnOrigin}${path}`,
  server: 'Server A',
  headers: { Referer: site.referer },
  ...extra,
});

/** Plain `fetch` standing in for the extension session. */
export const fetchUpstream: DownloadUpstream = (url, init) =>
  fetch(url, { headers: init.headers, signal: init.signal ?? null, redirect: 'follow' });

export interface EnvOptions {
  streamsFor: DownloadServiceDeps['streamsFor'];
  upstream?: DownloadUpstream;
  freeBytes?: DownloadServiceDeps['freeBytes'];
  now?: () => number;
  fetchOptions?: DownloadServiceDeps['fetchOptions'];
  assertAvailable?: (sourceId: string) => void;
}

export class Env {
  readonly emitted: DownloadProgress[][] = [];
  readonly services: DownloadService[] = [];
  online = true;
  private readonly listeners = new Set<(online: boolean) => void>();

  private constructor(
    readonly db: TestDb,
    readonly folder: string,
    private readonly options: EnvOptions,
  ) {}

  static async create(options: EnvOptions): Promise<Env> {
    const db = await createTestDb();
    return new Env(db, mkdtempSync(join(tmpdir(), 'matane-downloads-')), options);
  }

  /** A service on this database; a second one is what the app is after a restart. */
  service(overrides: Partial<DownloadServiceDeps> = {}): DownloadService {
    const service = new DownloadService({
      downloads: this.db.downloads,
      episodes: this.db.episodes,
      anime: this.db.anime,
      settings: this.db.settings,
      sourceName: () => 'Example (EN)',
      assertAvailable: this.options.assertAvailable ?? (() => undefined),
      streamsFor: this.options.streamsFor,
      upstream: this.options.upstream ?? fetchUpstream,
      defaultFolder: () => this.folder,
      isOnline: () => this.online,
      onOnlineChange: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      emitProgress: (items) => this.emitted.push(items),
      ready: Promise.resolve(),
      ...(this.options.now && { now: this.options.now }),
      ...(this.options.freeBytes && { freeBytes: this.options.freeBytes }),
      // No waiting between retries, but real retries.
      fetchOptions: { sleep: async () => undefined, timeoutMs: 5000, ...this.options.fetchOptions },
      ...overrides,
    });
    this.services.push(service);
    return service;
  }

  setOnline(online: boolean): void {
    this.online = online;
    for (const listener of this.listeners) listener(online);
  }

  /** Episodes 1…count of a new anime, as ids. */
  addEpisodes(title: string, count: number): number[] {
    const [row] = this.db.anime.upsertSummaries('example/en', [{ url: `/${title}`, title }]);
    this.db.episodes.sync(
      row!.id,
      Array.from({ length: count }, (_, i) => ({ url: `/${title}/${i + 1}`, name: `Episode ${i + 1}`, number: i + 1 })),
      100,
    );
    return (
      this.db.connection.sqlite.prepare('SELECT id FROM episodes WHERE anime_id = ? ORDER BY number').all(row!.id) as {
        id: number;
      }[]
    ).map((r) => r.id);
  }

  row(episodeId: number) {
    return this.db.downloads.byEpisode(episodeId);
  }

  close(): void {
    for (const service of this.services) service.shutdown();
    this.db.close();
    rmSync(this.folder, { recursive: true, force: true });
  }
}

/** Waits until `condition` holds, polling; for things that happen in the background. */
export async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for a condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Every file under a folder, relative, sorted. */
export function tree(root: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) out.push(...tree(path, `${prefix}${name}/`));
    else out.push(`${prefix}${name}`);
  }
  return out;
}
