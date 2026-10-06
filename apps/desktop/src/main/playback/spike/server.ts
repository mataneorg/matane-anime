import { readFile } from 'node:fs/promises';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import type { SpikeRequestLog } from '@matane-anime/shared';

/** The fake site refuses every request that lacks this Referer, like a site that checks hotlinking. */
export const REQUIRED_REFERER = 'https://example.test/';

const CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.flac': 'audio/flac',
  '.key': 'application/octet-stream',
};

export interface Site {
  name: 'a' | 'b' | 'c';
  /** `http://127.0.0.1:<port>` */
  origin: string;
  host: string;
  server: Server;
}

/**
 * Three fake sites on loopback. A serves the fixtures; B serves them too, for playlists whose segments
 * live on another host; C is a host that no manifest mentions, to prove the proxy never calls it.
 * No site sends CORS headers, so the renderer cannot read any of them directly.
 */
export class SpikeSites {
  readonly log: SpikeRequestLog[] = [];
  /** Segments of the expiring stream served since the last reset. */
  private expiringHits = 0;
  private sites: Site[] = [];

  constructor(
    private readonly root: string,
    /** How many segments of `expiring/` are served before it answers 403. */
    private readonly expireAfterSegments = 1,
  ) {}

  get a(): Site {
    return this.site('a');
  }
  get b(): Site {
    return this.site('b');
  }
  get c(): Site {
    return this.site('c');
  }

  private site(name: Site['name']): Site {
    const site = this.sites.find((s) => s.name === name);
    if (!site) throw new Error('Spike sites are not started');
    return site;
  }

  async start(): Promise<void> {
    for (const name of ['a', 'b', 'c'] as const) {
      const server = createServer((req, res) => void this.handle(name, req, res));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      this.sites.push({ name, origin: `http://127.0.0.1:${port}`, host: `127.0.0.1:${port}`, server });
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.sites.map((site) => new Promise((resolve) => site.server.close(resolve))));
    this.sites = [];
  }

  reset(): void {
    this.log.length = 0;
    this.expiringHits = 0;
  }

  private async handle(name: Site['name'], req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const referer = headerOf(req, 'referer');
    const range = headerOf(req, 'range');
    const finish = (status: number, headers: Record<string, string | number>, body?: Buffer | string): void => {
      res.writeHead(status, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
      this.log.push({
        host: this.site(name).host,
        path: url.pathname,
        status,
        range,
        referer,
        origin: headerOf(req, 'origin'),
      });
    };

    if (name === 'c') return finish(200, { 'content-type': 'text/plain' }, 'a host that no manifest mentions');
    if (!referer?.startsWith(REQUIRED_REFERER))
      return finish(403, { 'content-type': 'text/plain' }, 'referer required');

    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (relative.startsWith('expiring/')) {
      relative = relative.replace('expiring/', 'hls-ts/v360/');
      if (relative.endsWith('.ts') && ++this.expiringHits > this.expireAfterSegments) {
        return finish(403, { 'content-type': 'text/plain' }, 'stream expired');
      }
    }
    const file = normalize(join(this.root, relative));
    if (!file.startsWith(this.root + sep)) return finish(403, { 'content-type': 'text/plain' }, 'outside root');

    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      return finish(404, { 'content-type': 'text/plain' }, 'not found');
    }
    const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';

    if (extname(file) === '.m3u8') {
      // Playlists may point at the second site; its port is only known now.
      const text = body.toString('utf8').replaceAll('__SITE_B__', this.b.origin);
      return finish(200, { 'content-type': type }, text);
    }

    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (!match)
      return finish(200, { 'content-type': type, 'content-length': body.length, 'accept-ranges': 'bytes' }, body);
    const start = match[1] === '' ? Math.max(0, body.length - Number(match[2])) : Number(match[1]);
    const end = match[1] === '' || match[2] === '' ? body.length - 1 : Math.min(Number(match[2]), body.length - 1);
    if (start > end || start >= body.length) {
      return finish(416, { 'content-range': `bytes */${body.length}` });
    }
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
    );
  }
}

function headerOf(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}
