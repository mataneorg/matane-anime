import '@matane-anime/extension-sdk/globals';
import { type Episode, type Stream, NotFoundError, ParseError } from '@matane-anime/extension-sdk';
import { readGdriveplayerPlaylist } from './gdriveplayer';
import { unpackPacked } from './packed';
import { assertOk, base, fetchPage } from './site';

// An episode page names its servers twice: the default player `#pembed > iframe`, and `select.mirror > option`
// values that are base64 of `<iframe src="…">`. The hosts that can be read down to a direct video are:
//   Blogger (googlevideo mp4), vidhidepro and its mirrors (HLS from a packed script), gdriveplayer (HLS), ok.ru
//   (mp4), yourupload (mp4, needs its embed page as Referer) and desustream.net (an archive.org mp4).
// mega (end-to-end encrypted), abyssplayer (encrypted), terabox, the link shorteners and anything else are skipped,
// never thrown on. To support a new host, add a `Resolver` to RESOLVERS.

const EMBED_TIMEOUT_MS = 10_000;
/** More servers than this are never needed. */
const MAX_EMBEDS = 12;

/** Once a server has answered with a stream, the others get this long to make progress: a dead host would otherwise hold the answer for its whole timeout, retries included. */
const GRACE_MS = 3_000;

/** Waits for tasks that never reject, in input order, but stops once one is usable and none has settled for `GRACE_MS`. Late results are dropped. */
function settleWithGrace<T>(tasks: Promise<T>[], usable: (result: T) => boolean): Promise<T[]> {
  return new Promise((resolve) => {
    const slots: ({ value: T } | undefined)[] = tasks.map(() => undefined);
    let pending = tasks.length;
    let found = false;
    let ticks = 0;
    const finish = (): void => resolve(slots.flatMap((slot) => (slot ? [slot.value] : [])));
    if (pending === 0) finish();
    tasks.forEach((task, i) => {
      void task.then((value) => {
        slots[i] = { value };
        if (--pending === 0) return finish();
        found = found || usable(value);
        if (!found) return;
        const tick = ++ticks;
        void timers.sleep(GRACE_MS).then(() => tick === ticks && finish());
      });
    });
  });
}

/** A host the extension can read. `rank`: lower plays first. */
interface Resolver {
  match(url: URL): boolean;
  rank: number;
  resolve(url: URL): Promise<Stream[]>;
}

const decodeEntities = (text: string): string =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** The server addresses of an episode page, default player first, without duplicates or unreadable ones. */
export function readEmbeds(page: string): string[] {
  const found: string[] = [];
  const add = (raw: string | undefined): void => {
    const url = decodeEntities((raw ?? '').trim()).replace(/^\/\//, 'https://');
    if (/^https?:\/\//i.test(url) && !found.includes(url)) found.push(url);
  };
  const pembed = /id="pembed"[^>]*>[\s\S]*?<iframe\b[^>]*?\ssrc="([^"]*)"/i.exec(page)?.[1];
  add(pembed);
  for (const match of page.matchAll(/<option\b[^>]*\svalue="([^"]+)"/g)) {
    let decoded: string;
    try {
      decoded = base64.decode((match[1] as string).trim());
    } catch {
      continue;
    }
    add(/<iframe\b[^>]*?\ssrc=["']([^"']+)["']/i.exec(decoded)?.[1]);
  }
  return found;
}

// ------------------------------------------------------------------ Blogger

/** Heights of the itags Blogger serves. */
const ITAG_HEIGHT: Record<number, number> = { 18: 360, 22: 720, 37: 1080, 59: 480, 43: 360, 34: 360, 35: 480 };

/** Undoes the `\u003d` / `\u0026` escapes (the answer is JSON inside JSON, so they can come with several slashes). */
const unescapeJson = (text: string): string =>
  text
    .replace(/\\+u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\+\//g, '/');

/** Direct googlevideo mp4 links in a `WcwnYd` answer, with the height their itag stands for. */
export function parseBloggerResponse(text: string): { url: string; quality?: number }[] {
  const found = new Map<string, { url: string; quality?: number }>();
  for (const match of unescapeJson(text).matchAll(/https:\/\/[^\s"\\]+?googlevideo\.com\/videoplayback[^\s"\\]*/g)) {
    const url = match[0];
    const params = new URL(url).searchParams;
    // A SABR-only link (`sabr=1`, no itag) needs a protocol, not a plain GET.
    if (params.has('sabr') || !params.has('itag')) continue;
    const quality = ITAG_HEIGHT[Number(params.get('itag'))];
    found.set(url, { url, ...(quality && { quality }) });
  }
  return [...found.values()];
}

async function fromBlogger(embed: URL): Promise<Stream[]> {
  const token = embed.searchParams.get('token');
  if (!token) return [];
  // draft.blogger.com serves the same player; the RPC lives on whichever host the embed names.
  const rpc = `${embed.origin}/_/BloggerVideoPlayerUi/data/batchexecute?rpcids=WcwnYd&source-path=%2Fvideo.g&rt=c`;
  const payload = JSON.stringify([[['WcwnYd', JSON.stringify([token, '', 0]), null, 'generic']]]);
  const response = await http.post(rpc, `f.req=${encodeURIComponent(payload)}`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    timeoutMs: EMBED_TIMEOUT_MS,
    throwOnError: false,
  });
  assertOk(response, rpc);
  const links = parseBloggerResponse(response.text);
  if (links.length === 0) throw new ParseError('Blogger gave no video: the token may have expired');
  return links.map((link) => ({
    url: link.url,
    server: 'Blogger',
    kind: 'mp4' as const,
    ...(link.quality && { quality: link.quality }),
  }));
}

// ------------------------------------------------------------------ vidhidepro and its mirrors

/** The playlists in a vidhide page: its packed script holds `var links={"hls4":"…","hls2":"…"}` (hls3 mostly 404s). */
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

async function fromVidhide(embed: URL): Promise<Stream[]> {
  // The page redirects through a few mirror domains (vidhidepro → vidhidefast → callistanise…).
  const response = await http.get(embed.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, embed.href);
  const origin = new URL(response.url || embed.href).origin;
  const playlists = parseVidhideLinks(response.text, origin);
  if (playlists.length === 0) throw new ParseError('The vidhide player has no playlist');
  // Both CDNs are offered: one of them is sometimes down, and the app falls back to the next stream.
  return playlists.map((url, i) => ({ url, server: i === 0 ? 'Vidhide' : `Vidhide ${i + 1}`, kind: 'hls' as const }));
}

// ------------------------------------------------------------------ gdriveplayer

async function fromGdriveplayer(embed: URL): Promise<Stream[]> {
  const response = await http.get(embed.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, embed.href);
  const playlist = readGdriveplayerPlaylist(response.text, embed.origin);
  if (!playlist) throw new ParseError('The gdriveplayer page has no playlist');
  return [{ url: playlist, server: 'Gdriveplayer', kind: 'hls' }];
}

// ------------------------------------------------------------------ ok.ru

/** Heights of the names ok.ru gives its mp4 files. */
const OKRU_HEIGHT: Record<string, number> = {
  mobile: 144,
  lowest: 240,
  low: 360,
  sd: 480,
  hd: 720,
  full: 1080,
  quad: 1440,
  ultra: 2160,
};

/** The mp4 files of an ok.ru embed page: `data-options` → `flashvars.metadata` (a JSON string) → `videos[]`. */
export function parseOkruVideos(page: string): { url: string; quality?: number }[] {
  const options = /data-options="([^"]+)"/.exec(page)?.[1];
  if (!options) return [];
  try {
    const flashvars = (JSON.parse(decodeEntities(options)) as { flashvars?: { metadata?: unknown } }).flashvars;
    const metadata = typeof flashvars?.metadata === 'string' ? JSON.parse(flashvars.metadata) : flashvars?.metadata;
    const videos = (metadata as { videos?: { name?: string; url?: string }[] } | undefined)?.videos ?? [];
    return videos
      .filter((v) => typeof v.url === 'string' && /^https?:\/\//.test(v.url))
      .map((v) => {
        const quality = OKRU_HEIGHT[v.name ?? ''];
        return { url: v.url as string, ...(quality && { quality }) };
      });
  } catch {
    return [];
  }
}

async function fromOkru(embed: URL): Promise<Stream[]> {
  const response = await http.get(embed.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, embed.href);
  const videos = parseOkruVideos(response.text);
  // A removed or private video has no list: that is no stream, not a failure.
  return videos.map((v) => ({
    url: v.url,
    server: 'OK.ru',
    kind: 'mp4' as const,
    ...(v.quality && { quality: v.quality }),
  }));
}

// ------------------------------------------------------------------ desustream.net

/** The archive.org file in a desustream player page (`file:"https://archive.org/download/…/x.mp4"`). */
export function parseDesustreamSource(page: string): string | undefined {
  return /\bfile\s*:\s*"(https:\/\/archive\.org\/download\/[^"]+\.mp4)"/.exec(page)?.[1];
}

async function fromDesustream(embed: URL): Promise<Stream[]> {
  const response = await http.get(embed.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, embed.href);
  const src = parseDesustreamSource(response.text);
  if (!src) throw new ParseError('The desustream player has no file');
  return [{ url: src, server: 'Desustream', kind: 'mp4' }];
}

// ------------------------------------------------------------------ yourupload

/** The mp4 in a yourupload embed page; a removed file points at `/embed/novideo.mp4`, a blocked one has none. */
export function parseYouruploadSource(page: string): string | undefined {
  return /\bfile:\s*'(https:\/\/[^']+\.mp4[^']*)'/.exec(page)?.[1];
}

async function fromYourupload(embed: URL): Promise<Stream[]> {
  const response = await http.get(embed.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, embed.href);
  const src = parseYouruploadSource(response.text);
  if (!src || src.includes('/novideo.mp4')) return [];
  // The video host answers 500 without the embed page as Referer.
  return [{ url: src, server: 'Yourupload', kind: 'mp4', headers: { Referer: embed.href } }];
}

// ------------------------------------------------------------------ all of them

const host = (url: URL, name: string): boolean => url.hostname === name || url.hostname.endsWith(`.${name}`);

/** The vidhide family: the same player under rotating domains, always `/v/<id>` or `/e/<id>`. */
const VIDHIDE_HOSTS = ['vidhidepro.com', 'vidhide.com', 'vidhidefast.com', 'callistanise.com', 'filelions.live'];

/** Blogger first, then the HLS players, then the plain mp4 hosts. */
const RESOLVERS: Resolver[] = [
  { match: (u) => host(u, 'blogger.com') && u.pathname.startsWith('/video.g'), rank: 0, resolve: fromBlogger },
  {
    match: (u) => VIDHIDE_HOSTS.some((h) => host(u, h)) && /^\/[ve]\//.test(u.pathname),
    rank: 1,
    resolve: fromVidhide,
  },
  { match: (u) => host(u, 'gdriveplayer.to') && u.pathname.startsWith('/embed'), rank: 2, resolve: fromGdriveplayer },
  { match: (u) => host(u, 'ok.ru') && u.pathname.startsWith('/videoembed/'), rank: 3, resolve: fromOkru },
  {
    match: (u) => host(u, 'desustream.net') && u.pathname.startsWith('/dstream/arcg'),
    rank: 4,
    resolve: fromDesustream,
  },
  {
    match: (u) => /^(?:www\.)?yourupload\.[a-z]+$/.test(u.hostname) && u.pathname.startsWith('/embed/'),
    rank: 5,
    resolve: fromYourupload,
  },
];

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const url = `${base()}${episode.url}`;
  const page = (await fetchPage(url)).text;
  const embeds = readEmbeds(page).slice(0, MAX_EMBEDS);

  let skipped = 0;
  let failures = 0;
  const results = await settleWithGrace(
    embeds.map(async (embed) => {
      let target: URL;
      try {
        target = new URL(embed);
      } catch {
        skipped++;
        return { rank: 99, streams: [] as Stream[] };
      }
      const resolver = RESOLVERS.find((r) => r.match(target));
      if (!resolver) {
        skipped++;
        return { rank: 99, streams: [] as Stream[] };
      }
      try {
        return { rank: resolver.rank, streams: await resolver.resolve(target) };
      } catch (error) {
        log.warn(`Server ${target.hostname} failed:`, (error as Error).message);
        failures++;
        return { rank: 99, streams: [] as Stream[] };
      }
    }),
    (result) => result.streams.length > 0,
  );

  const seen = new Set<string>();
  const streams = results
    .flatMap((r) => r.streams.map((stream) => ({ stream, rank: r.rank })))
    .sort((a, b) => a.rank - b.rank || (b.stream.quality ?? 0) - (a.stream.quality ?? 0))
    .map((entry) => entry.stream)
    .filter((stream) => !seen.has(stream.url) && !!seen.add(stream.url));
  if (streams.length > 0) return streams;

  throw new NotFoundError(
    failures > 0
      ? 'No server of this episode could be read'
      : skipped > 0
        ? 'This episode is only on servers the app cannot play (mega, abyssplayer, terabox…)'
        : 'This episode has no readable server',
  );
}
