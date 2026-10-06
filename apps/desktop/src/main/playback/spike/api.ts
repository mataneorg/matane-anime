import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, normalize } from 'node:path';
import {
  AppError,
  type SpikeFixture,
  type SpikeRequestLog,
  type SpikeResult,
  type SpikeStartResult,
} from '@matane-anime/shared';
import { resourceUrl } from '../proxy';
import type { SessionStore } from '../sessions';
import { FIXTURES, findFixture } from './fixtures';
import { REQUIRED_REFERER, SpikeSites } from './server';

export interface SpikeEnvironment {
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
  /** Which upstream implementation main used: `net.fetch` or `net.request`. */
  upstream: string;
}

export interface SpikeApiOptions {
  fixturesDir: string;
  outFile: string;
  sessions: SessionStore;
  environment: SpikeEnvironment;
}

/** Everything the playback spike needs in main: the fake sites, one session per fixture, and the results file. */
export class SpikeApi {
  private readonly results = new Map<string, SpikeResult>();

  private constructor(
    private readonly options: SpikeApiOptions,
    private readonly sites: SpikeSites,
  ) {}

  static async create(options: SpikeApiOptions): Promise<SpikeApi> {
    const sites = new SpikeSites(normalize(options.fixturesDir));
    await sites.start();
    return new SpikeApi(options, sites);
  }

  fixtures(): SpikeFixture[] {
    return FIXTURES.map(({ path: _path, ...fixture }) => fixture);
  }

  start(id: string): SpikeStartResult {
    const fixture = findFixture(id);
    if (!fixture) throw new AppError('not_found', `Unknown spike fixture: ${id}`);
    const entryUrl = `${this.sites.a.origin}/${fixture.path}`;
    const session = this.options.sessions.create({
      entryUrl,
      kind: fixture.kind,
      headers: { Referer: `${REQUIRED_REFERER}watch`, Origin: REQUIRED_REFERER.replace(/\/$/, '') },
    });
    const extension = extname(fixture.path) || '.bin';
    return {
      sessionId: session.id,
      url: `anime://play/${session.id}/${fixture.kind === 'hls' ? 'index.m3u8' : `media${extension}`}`,
      kind: fixture.kind,
      directUrl: entryUrl,
      forbiddenUrl: resourceUrl(session.id, `${this.sites.c.origin}/forbidden.ts`),
    };
  }

  stats(): SpikeRequestLog[] {
    return [...this.sites.log];
  }

  /** Clears the request log, the expiring counter and every session (results are kept). */
  reset(): void {
    this.sites.reset();
    this.options.sessions.clear();
  }

  report(result: SpikeResult): void {
    this.results.set(result.id, result);
    mkdirSync(dirname(this.options.outFile), { recursive: true });
    writeFileSync(
      this.options.outFile,
      JSON.stringify(
        {
          ...this.options.environment,
          generatedAt: new Date().toISOString(),
          results: Object.fromEntries(this.results),
        },
        null,
        2,
      ),
    );
  }

  /** `host:port` of the site that must never be called (for assertions). */
  get forbiddenHost(): string {
    return this.sites.c.host;
  }

  close(): Promise<void> {
    return this.sites.close();
  }
}
