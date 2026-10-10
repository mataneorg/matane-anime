import '@matane-anime/extension-sdk/globals';
import { type Episode, type Stream, NotFoundError, ParseError } from '@matane-anime/extension-sdk';
import { unpackPacked } from './packed';
import { assertOk, base, fetchPage } from './site';
import { labelHeight, splitEpisodeUrl } from './text';

// A series page carries, in its React Server Components payload (`self.__next_f.push([1,"…"])` chunks), the table
// of every link of the series: `"links":[{provider,quality,episode,kind,mode,playUrl,r2ObjectKey,url…},…]`. The
// objects of one episode are found by text search and decoded as JSON (nothing is evaluated): its hosts and
// qualities, with a single request. Read down to a playable file:
//   BerkasDrive (direct mp4 from its storage, no request), PDrain/pixeldrain (api file, no request),
//   VidHide (an HLS master, resolved for the best quality only: it adapts) and desustream (an archive.org or
//   googlevideo mp4, resolved for the best quality of each of its two players).
// Mega, Kraken, UsersDrive and TeraBox are skipped, never thrown on.

const EMBED_TIMEOUT_MS = 10_000;

export interface Link {
  provider?: string;
  url?: string;
  playUrl?: string;
  quality?: string | null;
  kind?: string;
  episode?: number | null;
  r2ObjectKey?: string | null;
}

/** The needle of a field in the page: the payload sits inside a JS string literal, so its quotes are escaped. */
const field = (name: string, value: string): string => `\\"${name}\\":${value}`;

/** True when the page carries the link table at all. */
export const hasLinkTable = (page: string): boolean => page.includes(`${field('links', '[')}`);

/**
 * The links of one episode. Some series have a payload of several megabytes (One Piece: 11 000 links), more than
 * the sandbox may decode in 2 s, so the page is searched for the objects of the episode (`"episode":<n>,`) and only
 * those few are decoded: each is a flat JSON object, inside a JS string literal (so it is unescaped first).
 */
export function linksOfEpisode(page: string, number: number): Link[] {
  const needle = `${field('episode', String(number))},`;
  const start = '{\\"id\\"';
  const found: Link[] = [];
  let from = 0;
  for (;;) {
    const hit = page.indexOf(needle, from);
    if (hit < 0) break;
    from = hit + needle.length;
    const open = page.lastIndexOf(start, hit);
    if (open < 0) continue;
    // The object ends at the first `}` that makes it valid JSON.
    let close = page.indexOf('}', hit);
    for (let tries = 0; close >= 0 && tries < 4; tries++, close = page.indexOf('}', close + 1)) {
      try {
        const link = JSON.parse(JSON.parse(`"${page.slice(open, close + 1)}"`) as string) as Link;
        if (link.kind === 'episode' && link.episode === number) found.push(link);
        break;
      } catch {
        // not closed yet (a `}` inside a value): try the next one
      }
    }
  }
  return found;
}

// ------------------------------------------------------------------ the hosts

/** The direct file of a BerkasDrive link: its storage, addressed by the object key. No Referer is needed. */
export function berkasdriveUrl(key: string): string {
  return `https://direct-stor.berkasdrive.com/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** The pixeldrain file of a `https://pixeldrain.com/u/<id>` link. */
export function pixeldrainFile(url: string): string | undefined {
  const id = /^https:\/\/pixeldrain\.com\/u\/([A-Za-z0-9]+)\/?$/.exec(url)?.[1];
  return id ? `https://pixeldrain.com/api/file/${id}` : undefined;
}

/** The playlists in a vidhide page: its packed script holds `var links={"hls4":"…","hls2":"…"}`. */
export function parseVidhideLinks(page: string, origin: string): string[] {
  const code = unpackPacked(page) ?? page;
  const object = /\blinks\s*=\s*(\{[^}]*\})/.exec(code)?.[1];
  if (!object) return [];
  let links: Record<string, unknown>;
  try {
    links = JSON.parse(object) as Record<string, unknown>;
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const key of ['hls4', 'hls2']) {
    const value = links[key];
    if (typeof value !== 'string' || !value) continue;
    const url = new URL(value.replace(/\\\//g, '/'), `${origin}/`).href;
    if (!found.includes(url)) found.push(url);
  }
  return found;
}

async function fromVidhide(link: Link): Promise<Stream[]> {
  // `desudrive.com/fl/?id=<id>` redirects to a vidhide domain's `/f/<id>`; the player page is `/v/<id>` there.
  const first = await http.get(link.url as string, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(first, link.url as string);
  const landed = new URL(first.url || (link.url as string));
  const id = /\/[fve]\/([A-Za-z0-9]+)/.exec(landed.pathname)?.[1] ?? new URL(link.url as string).searchParams.get('id');
  if (!id) throw new ParseError('The vidhide link has no file id');
  let page = first.text;
  let origin = landed.origin;
  if (!/\/v\//.test(landed.pathname) || parseVidhideLinks(page, origin).length === 0) {
    const player = `${landed.origin}/v/${id}`;
    const response = await http.get(player, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
    assertOk(response, player);
    page = response.text;
    origin = new URL(response.url || player).origin;
  }
  const playlists = parseVidhideLinks(page, origin);
  if (playlists.length === 0) throw new ParseError('The vidhide player has no playlist');
  return playlists.map((url, i) => ({ url, server: i === 0 ? 'VidHide' : `VidHide ${i + 1}`, kind: 'hls' as const }));
}

/** The address behind the site's workers proxy: `https://<proxy>/https://desustream.net/…` → the desustream one. */
export function desustreamUrl(url: string): string | undefined {
  const at = url.indexOf('https://desustream.net/');
  return at >= 0 ? url.slice(at) : undefined;
}

/** The mp4 in a desustream player page: an archive.org file, or a googlevideo `<source>`. */
export function parseDesustreamSource(page: string): string | undefined {
  const archive = /\bfile\s*:\s*"(https:\/\/archive\.org\/download\/[^"]+\.mp4)"/.exec(page)?.[1];
  if (archive) return archive;
  const source = /<source[^>]+src=["'](https:\/\/[^"']*googlevideo[^"']*)["']/i.exec(page)?.[1];
  return source?.replace(/&amp;/g, '&');
}

async function fromDesustream(link: Link): Promise<Stream[]> {
  const url = desustreamUrl(link.url ?? '');
  if (!url) return [];
  const response = await http.get(url, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, url);
  const src = parseDesustreamSource(response.text);
  if (!src) throw new ParseError('The desustream player has no file');
  const quality = labelHeight(link.quality);
  return [{ url: src, server: 'Desustream', kind: 'mp4', ...(quality && { quality }) }];
}

// ------------------------------------------------------------------ one episode

interface Candidate {
  rank: number;
  height: number;
  resolve(): Promise<Stream[]>;
}

/** The best link of each group: the hosts that cost requests are resolved once per player, not per quality. */
function best<T extends { height: number }>(items: T[], group: (item: T) => string): T[] {
  const top = new Map<string, T>();
  for (const item of items) {
    const key = group(item);
    const current = top.get(key);
    if (!current || item.height > current.height) top.set(key, item);
  }
  return [...top.values()];
}

export function candidatesOf(mine: Link[]): Candidate[] {
  const out: Candidate[] = [];
  const now = (stream: Stream, rank: number, height: number): Candidate => ({
    rank,
    height,
    resolve: () => Promise.resolve([stream]),
  });

  for (const link of mine) {
    const height = labelHeight(link.quality) ?? 0;
    if (link.provider === 'BerkasDrive' && link.r2ObjectKey) {
      out.push(
        now(
          {
            url: berkasdriveUrl(link.r2ObjectKey),
            server: 'BerkasDrive',
            kind: 'mp4',
            ...(height && { quality: height }),
          },
          0,
          height,
        ),
      );
    } else if (link.provider === 'PDrain') {
      const file = pixeldrainFile(link.url ?? '');
      if (file)
        out.push(now({ url: file, server: 'Pixeldrain', kind: 'mp4', ...(height && { quality: height }) }, 1, height));
    }
  }
  const vidhide = mine
    .filter((l) => l.provider === 'VidHide' && l.url)
    .map((link) => ({ link, height: labelHeight(link.quality) ?? 0 }));
  for (const { link, height } of best(vidhide, () => 'vidhide')) {
    out.push({ rank: 2, height, resolve: () => fromVidhide(link) });
  }
  const desustream = mine
    .filter((l) => l.provider === 'Komikcast' && desustreamUrl(l.url ?? ''))
    .map((link) => ({ link, height: labelHeight(link.quality) ?? 0 }));
  // Two players (otakuwatch3 and arcg), each in 480p and 720p.
  for (const { link, height } of best(
    desustream,
    ({ link }) => /desustream\.net\/dstream\/([^/]+)/.exec(link.url ?? '')?.[1] ?? '',
  )) {
    out.push({ rank: 3, height, resolve: () => fromDesustream(link) });
  }
  return out;
}

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const parts = splitEpisodeUrl(episode.url);
  if (!parts) throw new NotFoundError(`Not an episode of this site: ${episode.url}`);
  const page = (await fetchPage(`${base()}${parts.series}`)).text;
  if (!hasLinkTable(page)) throw new ParseError('The series page has no link table: the site layout changed');
  const mine = linksOfEpisode(page, parts.number);
  const candidates = candidatesOf(mine);
  if (candidates.length === 0) {
    throw new NotFoundError(
      mine.length > 0
        ? 'This episode is only on hosts the app cannot play (mega, kraken, usersdrive…)'
        : 'This episode has no link yet',
    );
  }

  let failures = 0;
  const results = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        return { candidate, streams: await candidate.resolve() };
      } catch (error) {
        log.warn('A server failed:', (error as Error).message);
        failures++;
        return { candidate, streams: [] as Stream[] };
      }
    }),
  );

  // The best quality first; at the same quality the hosts with the fewest requests first.
  const seen = new Set<string>();
  const streams = results
    .sort((a, b) => b.candidate.height - a.candidate.height || a.candidate.rank - b.candidate.rank)
    .flatMap((r) => r.streams)
    .filter((stream) => !seen.has(stream.url) && !!seen.add(stream.url));
  if (streams.length > 0) return streams;
  throw new NotFoundError(
    failures > 0 ? 'No server of this episode could be read' : 'This episode has no readable server',
  );
}
