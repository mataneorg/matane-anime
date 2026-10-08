import { createCipheriv } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import {
  CATALOG,
  type CatalogEntry,
  GENRE_LIST,
  type Query,
  STREAM_FIXTURES,
  episodesOf,
  findAnime,
  query,
} from './catalog.ts';

export interface TestSiteOptions {
  /** Folder with the media fixtures (`hls-ts/`, `mp4/`, …): apps/desktop/e2e/fixtures/media. */
  mediaDir: string;
  /** Segments of the expiring stream served before it answers 403. Default 1. */
  expireAfterSegments?: number;
  /** How long the fake Cloudflare challenge "thinks" before it sets its cookie. Default 300 ms. */
  challengeMs?: number;
}

/** Slows media responses (not playlists), so a download stays in flight long enough to pause, cancel or time. */
export interface Throttle {
  /** Wait this long before answering a media request. */
  segmentDelayMs?: number;
  /** Send media at about this speed. */
  bytesPerSecond?: number;
}

/** Makes matching media requests misbehave, as a flaky CDN would. */
export interface Fault {
  /** Matched against the request path: a substring, or a RegExp. */
  pattern: string | RegExp;
  /** Answer with this status instead of the file. */
  status?: number;
  /** Send this many bytes of the body, then cut the connection. */
  resetAfterBytes?: number;
  /** Apply from the n-th matching request on (1-based). Default 1. */
  from?: number;
  /** ...for this many requests. Default: every one from `from` on. */
  times?: number;
}

export interface RequestLogEntry {
  /** `site` or `cdn`. */
  server: 'site' | 'cdn';
  method: string;
  path: string;
  search: string;
  status: number;
  referer: string | null;
  origin: string | null;
  userAgent: string | null;
  range: string | null;
  cookie: string | null;
}

/** The key and IV behind the "Server B" embeds, so extension tests can decrypt them with `crypto.aesDecrypt`. */
export const EMBED_KEY = Buffer.from('matane-test-key!', 'utf8');
export const EMBED_IV = Buffer.alloc(16, 1);

const CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.key': 'application/octet-stream',
};

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A fake anime site with two hosts: `origin` serves pages, embeds and covers; `cdnOrigin` serves media, so
 * stream URLs really are on another host. Both refuse requests without the site's Referer where a real
 * site would (embeds and media). Neither sends CORS headers.
 *
 *   /popular /latest /search?q&status&genre&sort&dir&page   listings (HTML)
 *   /anime/<slug>                                           detail (HTML)
 *   /anime/<slug>/episodes.json                             episodes, newest first
 *   /watch/<slug>/<number>?variant=Sub                      episode page with server buttons
 *   /embed/<id>                                             player config (A: plain, B: AES payload);
 *                                                           see StreamKind for how streams behave
 *   /img/<slug>.svg                                         cover
 *   /cf/<any of the above>                                  the same, behind a Cloudflare-style challenge
 *   /_t/{echo,flaky,limited,redirect,slow,big}              helpers for the network layer's tests
 */
export class TestSite {
  readonly log: RequestLogEntry[] = [];
  private servers: { name: 'site' | 'cdn'; server: Server; origin: string }[] = [];
  /** Segments served per expiring stream token. */
  private expiringHits = new Map<string, number>();
  /** How often each embed was fetched (a renewed token changes what the second fetch returns). */
  private embedHits = new Map<string, number>();
  private flakyHits = 0;
  private limitedHits = 0;
  private throttle: Throttle = {};
  private faults: { fault: Fault; hits: number }[] = [];
  /** Episode counts that differ from the catalog's (`setEpisodeCount`), and when the extra ones appeared. */
  private episodeCounts = new Map<string, { count: number; at: number }>();
  /** Fixed at the first start, so `resume` listens on the same ports. */
  private origins: { site: string; cdn: string } | null = null;
  private ports: Record<'site' | 'cdn', number> = { site: 0, cdn: 0 };

  private readonly options: Required<TestSiteOptions>;

  private constructor(options: Required<TestSiteOptions>) {
    this.options = options;
  }

  static async start(options: TestSiteOptions): Promise<TestSite> {
    const site = new TestSite({ expireAfterSegments: 1, challengeMs: 300, ...options });
    await site.listen();
    site.origins = { site: site.find('site').origin, cdn: site.find('cdn').origin };
    return site;
  }

  private async listen(): Promise<void> {
    for (const name of ['site', 'cdn'] as const) {
      const server = createServer((req, res) => void this.handle(name, req, res));
      // After a `stop` the port can take a moment to come back.
      for (let attempt = 0; ; attempt++) {
        try {
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(this.ports[name], '127.0.0.1', () => {
              server.off('error', reject);
              resolve();
            });
          });
          break;
        } catch (error) {
          if (attempt >= 20 || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      const { port } = server.address() as AddressInfo;
      this.ports[name] = port;
      this.servers.push({ name, server, origin: `http://127.0.0.1:${port}` });
    }
  }

  get origin(): string {
    return this.origins?.site ?? this.find('site').origin;
  }

  get cdnOrigin(): string {
    return this.origins?.cdn ?? this.find('cdn').origin;
  }

  /** The Referer media and embeds need. */
  get referer(): string {
    return `${this.origin}/`;
  }

  /** Takes the site offline: every connection is cut and the ports refuse new ones, until `resume`. */
  async stop(): Promise<void> {
    await Promise.all(
      this.servers.map(
        ({ server }) =>
          new Promise((resolve) => {
            server.close(resolve);
            server.closeAllConnections();
          }),
      ),
    );
    this.servers = [];
  }

  /** Brings the site back on the same ports it had, with its state (log, counters, faults) as it was. */
  async resume(): Promise<void> {
    if (this.servers.length === 0) await this.listen();
  }

  /** Stops for good. */
  async close(): Promise<void> {
    await this.stop();
  }

  /** The site now lists this many episodes of an anime; the new ones are uploaded "now" (an update to find). */
  setEpisodeCount(slug: string, count: number): void {
    const entry = findAnime(slug);
    if (!entry) throw new Error(`No such anime: ${slug}`);
    this.episodeCounts.set(slug, { count, at: Date.now() });
  }

  setThrottle(throttle: Throttle): void {
    this.throttle = throttle;
  }

  addFault(fault: Fault): void {
    this.faults.push({ fault, hits: 0 });
  }

  clearFaults(): void {
    this.faults = [];
  }

  private episodeCount(entry: CatalogEntry): number {
    return this.episodeCounts.get(entry.slug)?.count ?? entry.episodes;
  }

  private episodeList(entry: CatalogEntry) {
    const override = this.episodeCounts.get(entry.slug);
    return episodesOf(entry, override ? { count: override.count, extraUploadedAt: override.at } : {});
  }

  reset(): void {
    this.throttle = {};
    this.faults = [];
    this.episodeCounts.clear();
    this.log.length = 0;
    this.expiringHits.clear();
    this.embedHits.clear();
    this.flakyHits = 0;
    this.limitedHits = 0;
  }

  private find(name: 'site' | 'cdn') {
    const found = this.servers.find((s) => s.name === name);
    if (!found) throw new Error('The test site is not started');
    return found;
  }

  private async handle(name: 'site' | 'cdn', req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const range = header(req, 'range');
    const finish = (
      status: number,
      headers: Record<string, string | number>,
      body?: Buffer | string,
      options: { throttle?: boolean; resetAfterBytes?: number } = {},
    ): void => {
      res.writeHead(status, headers);
      const { segmentDelayMs = 0, bytesPerSecond = 0 } = options.throttle ? this.throttle : {};
      if (
        req.method !== 'HEAD' &&
        Buffer.isBuffer(body) &&
        (segmentDelayMs || bytesPerSecond || options.resetAfterBytes !== undefined)
      ) {
        void sendSlowly(res, body, { segmentDelayMs, bytesPerSecond, resetAfterBytes: options.resetAfterBytes });
      } else {
        res.end(req.method === 'HEAD' ? undefined : body);
      }
      this.log.push({
        server: name,
        method: req.method ?? 'GET',
        path: url.pathname,
        search: url.search,
        status,
        referer: header(req, 'referer'),
        origin: header(req, 'origin'),
        userAgent: header(req, 'user-agent'),
        range,
        cookie: header(req, 'cookie'),
      });
    };
    const html = (body: string, status = 200): void =>
      finish(status, { 'content-type': 'text/html; charset=utf-8' }, body);
    const json = (value: unknown): void => finish(200, { 'content-type': 'application/json' }, JSON.stringify(value));
    const plain = (status: number, text: string, headers: Record<string, string> = {}): void =>
      finish(status, { 'content-type': 'text/plain', ...headers }, text);

    try {
      if (name === 'cdn') return await this.media(req, url, range, finish, plain);

      let path = decodeURIComponent(url.pathname);
      if (path.startsWith('/cf/') || path === '/cf') {
        const cookies = header(req, 'cookie') ?? '';
        if (!/(?:^|;\s*)cf_clearance=ok(?:;|$)/.test(cookies)) {
          return finish(
            503,
            { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
            `<!doctype html><title>Just a moment...</title><h1>Checking your browser</h1>` +
              `<script>setTimeout(function(){document.cookie='cf_clearance=ok; path=/';location.reload();},${this.options.challengeMs});</script>`,
          );
        }
        path = path.slice('/cf'.length) || '/';
      }

      const params = (): Query => ({
        q: url.searchParams.get('q') ?? undefined,
        status: url.searchParams.get('status') ?? undefined,
        genre: url.searchParams.get('genre') ?? undefined,
        sort: (url.searchParams.get('sort') as Query['sort']) ?? undefined,
        dir: (url.searchParams.get('dir') as Query['dir']) ?? undefined,
        page: Math.max(1, Number(url.searchParams.get('page')) || 1),
      });

      const listed = CATALOG.filter((entry) => !entry.hidden);
      if (path === '/popular')
        return html(this.listing('Popular', query(listed, { ...params(), sort: 'popular' }), url));
      if (path === '/latest') {
        return html(this.listing('Latest', query([...listed].reverse(), { ...params(), sort: undefined }), url));
      }
      if (path === '/search') {
        // Hidden series show up only when searched for.
        return html(this.listing('Search', query(params().q ? CATALOG : listed, params()), url));
      }
      if (path === '/filters.json') return json({ genres: GENRE_LIST, statuses: ['ongoing', 'completed'] });

      let match = /^\/anime\/([^/]+)$/.exec(path);
      if (match) {
        const entry = findAnime(match[1] as string);
        return entry ? html(this.detail(entry)) : plain(404, 'no such anime');
      }
      match = /^\/anime\/([^/]+)\/episodes\.json$/.exec(path);
      if (match) {
        const entry = findAnime(match[1] as string);
        return entry ? json({ episodes: this.episodeList(entry) }) : plain(404, 'no such anime');
      }
      match = /^\/watch\/([^/]+)\/(\d+)$/.exec(path);
      if (match) return this.watch(match[1] as string, Number(match[2]), url, html, plain);
      match = /^\/embed\/(.+)$/.exec(path);
      if (match) return this.embed(match[1] as string, req, html, plain);
      match = /^\/img\/([^/]+)\.svg$/.exec(path);
      if (match) {
        const entry = findAnime(match[1] as string);
        if (!entry) return plain(404, 'no such cover');
        return finish(200, { 'content-type': 'image/svg+xml' }, cover(entry));
      }

      if (path.startsWith('/_t/')) return await this.helper(path.slice(4), req, url, finish, json, plain);
      return plain(404, 'not found');
    } catch (error) {
      return plain(500, `test site error: ${String(error)}`);
    }
  }

  // ----------------------------------------------------------------- pages

  private listing(title: string, result: { items: CatalogEntry[]; hasNext: boolean }, url: URL): string {
    const next = new URL(url);
    next.searchParams.set('page', String((Number(url.searchParams.get('page')) || 1) + 1));
    const cards = result.items
      .map(
        (e) =>
          `<div class="card" data-slug="${e.slug}"><a href="/anime/${e.slug}"><img src="/img/${e.slug}.svg" alt="">` +
          `<h3 class="title">${escapeHtml(e.title)}</h3></a><span class="year">${e.year}</span></div>`,
      )
      .join('\n');
    return (
      `<!doctype html><html><head><title>${title} · Test Anime Site</title></head><body>` +
      `<h1>${title}</h1><div class="grid">${cards}</div>` +
      (result.hasNext ? `<a class="next" href="${next.pathname}${next.search}">Next</a>` : '') +
      `</body></html>`
    );
  }

  private detail(e: CatalogEntry): string {
    return (
      `<!doctype html><html><head><title>${escapeHtml(e.title)}</title></head><body><article class="anime">` +
      `<img class="cover" src="/img/${e.slug}.svg" alt="">` +
      `<h1 class="title">${escapeHtml(e.title)}</h1>` +
      `<p class="alt">${e.alt.map(escapeHtml).join(' / ')}</p>` +
      `<p class="synopsis">${escapeHtml(e.description)}</p>` +
      `<ul class="genres">${e.genres.map((g) => `<li>${g}</li>`).join('')}</ul>` +
      `<dl><dt>Status</dt><dd class="status">${e.status}</dd><dt>Type</dt><dd class="type">${e.type}</dd>` +
      `<dt>Year</dt><dd class="year">${e.year}</dd><dt>Studio</dt><dd class="studio">${escapeHtml(e.studio)}</dd></dl>` +
      `<a class="episodes" href="/anime/${e.slug}/episodes.json">Episodes</a></article></body></html>`
    );
  }

  private watch(
    slug: string,
    number: number,
    url: URL,
    html: (body: string, status?: number) => void,
    plain: (status: number, text: string) => void,
  ): void {
    const entry = findAnime(slug);
    if (!entry || number < 1 || number > this.episodeCount(entry)) return plain(404, 'no such episode');
    const variant = (url.searchParams.get('variant') ?? entry.variants[0] ?? 'Sub').toLowerCase();
    const id = `${slug}-${number}-${variant}`;
    const servers =
      entry.streams === 'none'
        ? ''
        : `<li><a class="server" data-embed="/embed/${id}.a">Server A</a></li>` +
          `<li><a class="server" data-embed="/embed/${id}.b">Server B</a></li>`;
    return html(
      `<!doctype html><html><body><h1>${escapeHtml(entry.title)} · Episode ${number}</h1><ul class="servers">${servers}</ul></body></html>`,
    );
  }

  /** `<id>.a` is a plain player config; `<id>.b` hides the URL behind AES-128-CBC, like obfuscated embeds. */
  private embed(
    id: string,
    req: IncomingMessage,
    html: (body: string, status?: number) => void,
    plain: (status: number, text: string) => void,
  ): void {
    if (!header(req, 'referer')?.startsWith(this.referer)) return plain(403, 'referer required');
    const match = /^(.+)-(\d+)-([a-z]+)\.([ab])$/.exec(id);
    const entry = match ? findAnime(match[1] as string) : undefined;
    if (!match || !entry || entry.streams === 'none') return plain(404, 'no such embed');

    const hit = (this.embedHits.get(id) ?? 0) + 1;
    this.embedHits.set(id, hit);
    const side = match[4] as 'a' | 'b';
    const good = side === 'a' ? '/media/hls-ts/master.m3u8' : '/media/hls-fmp4/index.m3u8';
    const file = ((): string => {
      switch (entry.streams) {
        case 'mp4':
          return '/media/mp4/h264-aac.mp4';
        case 'long':
          return '/media/mp4/long.mp4';
        case 'expiring':
          return `/media/expiring/${id}/index.m3u8`;
        case 'fallback':
          return side === 'a' ? `/media/expiring/${id}/index.m3u8` : good;
        case 'refreshing':
          return side === 'a' && hit === 1 ? `/media/expiring/${id}-1/index.m3u8` : good;
        default:
          return STREAM_FIXTURES[entry.streams] ?? good;
      }
    })();
    const streamUrl = `${this.cdnOrigin}${file}`;

    if (match[4] === 'a') {
      const sources = [{ file: streamUrl, label: entry.streams === 'mp4' ? '360p' : '720p' }];
      return html(`<!doctype html><script>window.player = ${JSON.stringify({ sources })};</script>`);
    }
    const cipher = createCipheriv('aes-128-cbc', EMBED_KEY, EMBED_IV);
    const payload = Buffer.concat([cipher.update(streamUrl, 'utf8'), cipher.final()]).toString('base64');
    return html(`<!doctype html><div id="player" data-payload="${payload}" data-quality="360"></div>`);
  }

  // ----------------------------------------------------------------- media (cdn)

  private async media(
    req: IncomingMessage,
    url: URL,
    range: string | null,
    finish: (
      status: number,
      headers: Record<string, string | number>,
      body?: Buffer | string,
      options?: { throttle?: boolean; resetAfterBytes?: number },
    ) => void,
    plain: (status: number, text: string) => void,
  ): Promise<void> {
    if (!header(req, 'referer')?.startsWith(this.referer)) return plain(403, 'referer required');
    let relative = decodeURIComponent(url.pathname).replace(/^\/media\/?/, '');
    const expiring = /^expiring\/([^/]+)\//.exec(relative);
    if (expiring) {
      const token = expiring[1] as string;
      relative = relative.replace(expiring[0], 'hls-ts/v360/');
      if (relative.endsWith('.ts')) {
        const served = (this.expiringHits.get(token) ?? 0) + 1;
        this.expiringHits.set(token, served);
        if (served > this.options.expireAfterSegments) return plain(403, 'stream expired');
      }
    }
    const fault = this.faultFor(url.pathname);
    if (fault?.status !== undefined) return plain(fault.status, 'fault');
    const root = normalize(this.options.mediaDir);
    const file = normalize(join(root, relative));
    if (!file.startsWith(root + sep)) return plain(403, 'outside root');

    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      return plain(404, 'not found');
    }
    const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    if (extname(file) === '.m3u8') {
      return finish(200, { 'content-type': type }, body.toString('utf8').replaceAll('__SITE_B__', this.cdnOrigin));
    }
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (!match) {
      return finish(200, { 'content-type': type, 'content-length': body.length, 'accept-ranges': 'bytes' }, body, {
        throttle: true,
        resetAfterBytes: fault?.resetAfterBytes,
      });
    }
    const start = match[1] === '' ? Math.max(0, body.length - Number(match[2])) : Number(match[1]);
    const end = match[1] === '' || match[2] === '' ? body.length - 1 : Math.min(Number(match[2]), body.length - 1);
    if (start > end || start >= body.length) return finish(416, { 'content-range': `bytes */${body.length}` });
    const part = body.subarray(start, end + 1);
    return finish(
      206,
      {
        'content-type': type,
        'content-length': part.length,
        'content-range': `bytes ${start}-${end}/${body.length}`,
        'accept-ranges': 'bytes',
      },
      part,
      { throttle: true, resetAfterBytes: fault?.resetAfterBytes },
    );
  }

  /** The fault that applies to this request, counting the hit. */
  private faultFor(path: string): Fault | null {
    for (const entry of this.faults) {
      const { pattern, from = 1, times = Number.POSITIVE_INFINITY } = entry.fault;
      if (!(typeof pattern === 'string' ? path.includes(pattern) : pattern.test(path))) continue;
      const hit = ++entry.hits;
      if (hit >= from && hit < from + times) return entry.fault;
    }
    return null;
  }

  // ----------------------------------------------------------------- helpers for the network layer

  private async helper(
    name: string,
    req: IncomingMessage,
    url: URL,
    finish: (status: number, headers: Record<string, string | number>, body?: Buffer | string) => void,
    json: (value: unknown) => void,
    plain: (status: number, text: string, headers?: Record<string, string>) => void,
  ): Promise<void> {
    switch (name) {
      case 'echo':
        return json({
          method: req.method,
          userAgent: header(req, 'user-agent'),
          referer: header(req, 'referer'),
          origin: header(req, 'origin'),
          cookie: header(req, 'cookie'),
          contentType: header(req, 'content-type'),
          body: await readBody(req),
        });
      case 'flaky': // 500 twice, then fine
        return ++this.flakyHits <= 2 ? plain(500, 'try again') : plain(200, 'ok');
      case 'limited': // 429 once, then fine
        return ++this.limitedHits === 1 ? plain(429, 'slow down', { 'retry-after': '1' }) : plain(200, 'ok');
      case 'redirect':
        return finish(302, { location: url.searchParams.get('to') ?? '/' });
      case 'slow':
        await new Promise((resolve) => setTimeout(resolve, Number(url.searchParams.get('ms')) || 1000));
        return plain(200, 'slow');
      case 'big':
        return finish(
          200,
          { 'content-type': 'text/html' },
          `<ul>${'<li class="x">item</li>'.repeat((Number(url.searchParams.get('kb')) || 100) * 40)}</ul>`,
        );
      case 'status':
        return plain(Number(url.searchParams.get('code')) || 200, 'status');
      default:
        return plain(404, 'no such helper');
    }
  }
}

/** Writes `body` after a delay, at a limited speed, or cut off part way: what a slow or flaky CDN does. */
async function sendSlowly(
  res: ServerResponse,
  body: Buffer,
  options: { segmentDelayMs: number; bytesPerSecond: number; resetAfterBytes: number | undefined },
): Promise<void> {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  if (options.segmentDelayMs) await sleep(options.segmentDelayMs);
  const limit = options.resetAfterBytes ?? body.length;
  const chunk = options.bytesPerSecond ? Math.max(512, Math.floor(options.bytesPerSecond / 20)) : limit || 1;
  for (let sent = 0; sent < limit && !res.destroyed; sent += chunk) {
    const part = body.subarray(sent, Math.min(sent + chunk, limit));
    res.write(part);
    if (options.bytesPerSecond) await sleep((part.length / options.bytesPerSecond) * 1000);
  }
  if (options.resetAfterBytes !== undefined) {
    // Let the headers and what was written reach the client before the connection drops.
    await sleep(20);
    res.destroy();
  } else res.end();
}

function cover(entry: CatalogEntry): string {
  const hue = [...entry.slug].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420" viewBox="0 0 300 420">` +
    `<rect width="300" height="420" fill="hsl(${hue} 55% 45%)"/>` +
    `<text x="150" y="215" font-family="sans-serif" font-size="26" fill="#fff" text-anchor="middle">${escapeHtml(entry.title)}</text></svg>`
  );
}

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
