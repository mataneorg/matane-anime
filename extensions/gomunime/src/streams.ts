import '@matane-anime/extension-sdk/globals';
import { type Episode, type Stream, NotFoundError, ParseError } from '@matane-anime/extension-sdk';
import { assertOk, base, fetchPage } from './site';
import { readGdriveplayerPlaylist } from './gdriveplayer';
import { resolveGdplayer } from './gdplayer';
import { labelHeight } from './text';

// An episode page lists its servers inside Alpine `<template x-ref="embN">` blocks (an iframe, or for pixeldrain a
// link) and names them on buttons `show(N)`. The templates are read from the raw markup. Hosts that can be read
// down to a direct video are returned: xtwap btube3/cepat2, pixeldrain, Blogger, mp4upload, Google Drive,
// gdriveplayer (HLS) and gdplayer (through the mp4upload file it wraps). Everything else (mega, the
// anime-indo.lol wrappers, the old cepat.php…) is skipped, never thrown on.
// To support a new host, add a `Resolver` to RESOLVERS.

const EMBED_TIMEOUT_MS = 10_000;
/** More servers than this are never needed. */
const MAX_EMBEDS = 10;

export interface Embed {
  /** The button text ("B-TUBE", "pdrn 480p"). */
  label: string;
  url: string;
}

/** A host the extension can read. `rank`: lower plays first. */
interface Resolver {
  match(url: URL): boolean;
  rank: number;
  resolve(url: URL, embed: Embed): Promise<Stream[]>;
}

/** Heights of the itags Blogger serves. */
const ITAG_HEIGHT: Record<number, number> = { 18: 360, 22: 720, 37: 1080, 59: 480, 43: 360, 34: 360, 35: 480 };

const decodeEntities = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");

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

/** The googlevideo mp4 in a btube3 player page: `<source src="https://…googlevideo…">`. */
export function parseBtubeSource(page: string): string | undefined {
  const src = /<source[^>]+src="(https:\/\/[^"]*googlevideo[^"]*)"/i.exec(page)?.[1];
  return src ? decodeEntities(src) : undefined;
}

/** The HLS master playlist in a cepat2 player page (a JW Player config). */
export function parseCepatPlaylist(page: string): string | undefined {
  return /["']?file["']?\s*:\s*"(https?:[^"]+\.m3u8[^"]*)"/.exec(page)?.[1]?.replace(/\\\//g, '/');
}

/** The pixeldrain file id of `https://pixeldrain.com/u/<id>`. */
export function pixeldrainId(url: URL): string | undefined {
  return /^\/u\/([A-Za-z0-9]+)\/?$/.exec(url.pathname)?.[1];
}

/** The servers of an episode page, in page order (no duplicates, no unreadable markup). */
export function readEmbeds(page: string): Embed[] {
  const labels = new Map<number, string>();
  for (const match of page.matchAll(/@click="show\((\d+)\)"[^>]*>([^<]*)</g)) {
    labels.set(Number(match[1]), (match[2] as string).replace(/\s+/g, ' ').trim());
  }
  const embeds: Embed[] = [];
  for (const match of page.matchAll(/<template\s+x-ref="emb(\d+)"[^>]*>([\s\S]*?)<\/template>/g)) {
    const inner = match[2] as string;
    const raw =
      /<iframe\b[^>]*?\ssrc="([^"]+)"/i.exec(inner)?.[1] ??
      /<a[^>]+href="(https?:\/\/pixeldrain\.com\/u\/[^"]+)"/i.exec(inner)?.[1];
    // gdriveplayer's iframes are protocol-relative ("//gdriveplayer.to/…").
    const url = decodeEntities((raw ?? '').trim()).replace(/^\/\//, 'https://');
    if (!/^https?:\/\//i.test(url) || embeds.some((e) => e.url === url)) continue;
    embeds.push({ url, label: labels.get(Number(match[1])) ?? '' });
  }
  return embeds;
}

async function fromBtube(url: URL): Promise<Stream[]> {
  // Sent without a Referer: the page answers 403 to the site's own.
  const response = await http.get(url.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, url.href);
  const src = parseBtubeSource(response.text);
  if (!src) throw new ParseError('The btube player has no video');
  return [
    {
      url: src,
      server: 'B-Tube',
      kind: 'mp4',
      quality: ITAG_HEIGHT[Number(new URL(src).searchParams.get('itag'))] ?? 360,
    },
  ];
}

async function fromCepat(url: URL): Promise<Stream[]> {
  const response = await http.get(url.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, url.href);
  const playlist = parseCepatPlaylist(response.text);
  if (!playlist) throw new ParseError('The cepat player has no playlist');
  return [{ url: playlist, server: 'Cepat', kind: 'hls' }];
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

// The file is served straight from the API, no embed page to read and no Referer needed.
const fromPixeldrain = (url: URL, embed: Embed): Promise<Stream[]> => {
  const id = pixeldrainId(url);
  if (!id) return Promise.resolve([]);
  const quality = labelHeight(embed.label);
  return Promise.resolve([
    { url: `https://pixeldrain.com/api/file/${id}`, server: 'Pixeldrain', kind: 'mp4', ...(quality && { quality }) },
  ]);
};

/** The mp4 in an mp4upload embed page; a deleted file has none (`File was deleted`). */
export function parseMp4uploadSource(page: string): string | undefined {
  return /src:\s*"(https:\/\/[^"]+\.mp4)"/.exec(page)?.[1];
}

/** The id of `https://drive.google.com/file/d/<id>/preview`. */
export function driveId(url: URL): string | undefined {
  return /^\/file\/d\/([\w-]+)/.exec(url.pathname)?.[1];
}

async function fromMp4upload(url: URL): Promise<Stream[]> {
  const response = await http.get(url.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, url.href);
  const src = parseMp4uploadSource(response.text);
  // About one file in five has been deleted: that is no stream, not a failure.
  if (!src) return [];
  // The file host answers 403 to any other Referer.
  return [{ url: src, server: 'Mp4upload', kind: 'mp4', headers: { Referer: 'https://www.mp4upload.com/' } }];
}

async function fromDrive(url: URL): Promise<Stream[]> {
  const id = driveId(url);
  if (!id) return [];
  const direct = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  // A file over its download quota answers an HTML page instead of the video: look at the first byte.
  const response = await http.get(direct, {
    headers: { Range: 'bytes=0-0' },
    timeoutMs: EMBED_TIMEOUT_MS,
    throwOnError: false,
  });
  if (response.status >= 400 || !/^video\//i.test(response.headers['content-type'] ?? '')) return [];
  return [{ url: direct, server: 'Google Drive', kind: 'mp4' }];
}

async function fromGdriveplayer(url: URL): Promise<Stream[]> {
  const response = await http.get(url.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, url.href);
  const playlist = readGdriveplayerPlaylist(response.text, url.origin);
  if (!playlist) throw new ParseError('The gdriveplayer page has no playlist');
  return [{ url: playlist, server: 'Gdriveplayer', kind: 'hls' }];
}

async function fromGdplayer(url: URL): Promise<Stream[]> {
  // A fresh token every time: they belong to the page instance.
  const found = await resolveGdplayer(url.href, `${base()}/`, EMBED_TIMEOUT_MS);
  if (found.host !== 'mp4upload') return [];
  return fromMp4upload(new URL(`https://www.mp4upload.com/embed-${found.id}.html`));
}

const host = (url: URL, name: string): boolean => url.hostname === name || url.hostname.endsWith(`.${name}`);

/** Cepat HLS first, then the mp4s (B-Tube, Pixeldrain, Blogger, Google Drive, Mp4upload). */
const RESOLVERS: Resolver[] = [
  { match: (u) => host(u, 'xtwap.top') && /\/cepat2\.php$/.test(u.pathname), rank: 0, resolve: fromCepat },
  { match: (u) => host(u, 'xtwap.top') && /\/btube3\.php$/.test(u.pathname), rank: 1, resolve: fromBtube },
  { match: (u) => host(u, 'pixeldrain.com'), rank: 2, resolve: fromPixeldrain },
  { match: (u) => host(u, 'blogger.com') && u.pathname.startsWith('/video.g'), rank: 3, resolve: fromBlogger },
  { match: (u) => host(u, 'drive.google.com'), rank: 4, resolve: fromDrive },
  { match: (u) => host(u, 'mp4upload.com'), rank: 5, resolve: fromMp4upload },
  { match: (u) => host(u, 'gdriveplayer.to') && u.pathname.startsWith('/embed'), rank: 6, resolve: fromGdriveplayer },
  { match: (u) => host(u, 'gdplayer.to'), rank: 7, resolve: fromGdplayer },
];

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const url = `${base()}${episode.url}`;
  const page = (await fetchPage(url)).text;
  let embeds = readEmbeds(page);
  // gdplayer only wraps mp4upload: when the episode lists one itself, that is the same file without 3 extra requests.
  const hostOf = (e: Embed): string => e.url.replace(/^https?:\/\/([^/?#]*).*$/i, '$1').toLowerCase();
  if (embeds.some((e) => /(?:^|\.)mp4upload\.com$/.test(hostOf(e)))) {
    embeds = embeds.filter((e) => !/(?:^|\.)gdplayer\.to$/.test(hostOf(e)));
  }
  embeds = embeds.slice(0, MAX_EMBEDS);

  let skipped = 0;
  let failures = 0;
  const results = await Promise.all(
    embeds.map(async (embed) => {
      let target: URL;
      try {
        target = new URL(embed.url);
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
        return { rank: resolver.rank, streams: await resolver.resolve(target, embed) };
      } catch (error) {
        log.warn(`Server ${target.hostname} failed:`, (error as Error).message);
        failures++;
        return { rank: 99, streams: [] as Stream[] };
      }
    }),
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
        ? 'This episode is only on servers the app cannot play yet (gdplayer, mega, mp4upload…)'
        : 'This episode has no server',
  );
}
