import '@matane-anime/extension-sdk/globals';
import { type Episode, type Stream, NotFoundError, ParseError } from '@matane-anime/extension-sdk';
import { assertOk, base, fetchPage } from './site';
import { resolveGdplayer } from './gdplayer';
import { readGdriveplayerPlaylist } from './gdriveplayer';

// An episode page names its servers on buttons `div.servers a.server[data-video]` and shows the first one in
// `iframe#tontonin`. The readable hosts are: play.xtwap.top (cepat2.php and hls.php give an HLS playlist,
// btube3.php a googlevideo mp4), mp4upload (an mp4 that needs its own Referer), yourupload (reached through the
// site's `/yup.php?url=` wrapper), gdriveplayer (HLS) and gdplayer (through the mp4upload file it wraps). The old
// cepat.php and anything else are skipped, never thrown on.
// To support a new host, add a `Resolver` to RESOLVERS.

const EMBED_TIMEOUT_MS = 10_000;
/** More servers than this are never needed. */
const MAX_EMBEDS = 10;

export interface Embed {
  /** The button text ("B-TUBE", "MP4 HD"). */
  label: string;
  url: string;
}

/** A host the extension can read. `rank`: lower plays first. */
interface Resolver {
  match(url: URL): boolean;
  rank: number;
  resolve(url: URL, embed: Embed): Promise<Stream[]>;
}

const decodeEntities = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");

/** The googlevideo mp4 in a btube3 player page: `<source src="https://…googlevideo…">` (empty when the token is dead). */
export function parseBtubeSource(page: string): string | undefined {
  const src = /<source[^>]+src="(https:\/\/[^"]*googlevideo[^"]*)"/i.exec(page)?.[1];
  return src ? decodeEntities(src) : undefined;
}

/** The HLS master playlist in a cepat2.php / hls.php player page (a JW Player config). */
export function parsePlaylist(page: string): string | undefined {
  return /["']?file["']?\s*:\s*"(https?:[^"]+\.m3u8[^"]*)"/.exec(page)?.[1]?.replace(/\\\//g, '/');
}

/** The mp4 in an mp4upload embed page; a deleted file has none (`File was deleted`). */
export function parseMp4uploadSource(page: string): string | undefined {
  return /src:\s*"(https:\/\/[^"]+\.mp4)"/.exec(page)?.[1];
}

/** The mp4 in a yourupload embed page; a removed file points at `/embed/novideo.mp4`, a blocked one has none. */
export function parseYouruploadSource(page: string): string | undefined {
  return /\bfile:\s*'(https:\/\/[^']+\.mp4[^']*)'/.exec(page)?.[1];
}

/** `/yup.php?url=https://www.yourupload.com/embed/ID` → the yourupload address; any other address stays. */
export function unwrapEmbed(raw: string, baseUrl: string): string {
  try {
    const url = new URL(raw, `${baseUrl}/`);
    if (url.pathname === '/yup.php') return url.searchParams.get('url') ?? raw;
    return url.href;
  } catch {
    return raw;
  }
}

/** The servers of an episode page: the buttons first, then the default iframe when no button has it. */
export function readEmbeds(page: string, baseUrl: string): Embed[] {
  const embeds: Embed[] = [];
  const add = (label: string, raw: string): void => {
    const url = unwrapEmbed(decodeEntities(raw.trim()), baseUrl);
    if (/^https?:\/\//i.test(url) && !embeds.some((e) => e.url === url)) embeds.push({ label, url });
  };
  for (const match of page.matchAll(/<a\b[^>]*\sdata-video="([^"]*)"[^>]*>([^<]*)</g)) {
    add((match[2] as string).replace(/\s+/g, ' ').trim(), match[1] as string);
  }
  const iframe = /<iframe\b[^>]*\sid="tontonin"[^>]*\ssrc="([^"]*)"/i.exec(page)?.[1];
  if (iframe) add('', iframe);
  return embeds;
}

async function fromBtube(url: URL): Promise<Stream[]> {
  // Sent without a Referer: the page answers 403 to another site's.
  const response = await http.get(url.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, url.href);
  const src = parseBtubeSource(response.text);
  if (!src) throw new ParseError('The btube player has no video (its token is dead)');
  return [{ url: src, server: 'B-Tube', kind: 'mp4', quality: 360 }];
}

async function fromPlaylist(url: URL): Promise<Stream[]> {
  const response = await http.get(url.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, url.href);
  const playlist = parsePlaylist(response.text);
  if (!playlist) throw new ParseError('The player has no playlist');
  return [{ url: playlist, server: 'Cepat', kind: 'hls' }];
}

async function fromMp4upload(url: URL, embed: Embed): Promise<Stream[]> {
  const response = await http.get(url.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, url.href);
  const src = parseMp4uploadSource(response.text);
  // Many files have been deleted: that is no stream, not a failure.
  if (!src) return [];
  // The file host answers 403 to any other Referer.
  return [
    {
      url: src,
      server: /\bHD\b/i.test(embed.label) ? 'Mp4upload HD' : 'Mp4upload',
      kind: 'mp4',
      headers: { Referer: 'https://www.mp4upload.com/' },
    },
  ];
}

async function fromYourupload(url: URL, embed: Embed): Promise<Stream[]> {
  const response = await http.get(url.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, url.href);
  const src = parseYouruploadSource(response.text);
  if (!src || src.includes('/novideo.mp4')) return [];
  // The video host answers 500 without the embed page as Referer.
  return [
    {
      url: src,
      server: /\bHD\b/i.test(embed.label) ? 'Yourupload HD' : 'Yourupload',
      kind: 'mp4',
      headers: { Referer: url.href },
    },
  ];
}

async function fromGdriveplayer(url: URL): Promise<Stream[]> {
  const response = await http.get(url.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, url.href);
  const playlist = readGdriveplayerPlaylist(response.text, url.origin);
  if (!playlist) throw new ParseError('The gdriveplayer page has no playlist');
  return [{ url: playlist, server: 'Gdriveplayer', kind: 'hls' }];
}

async function fromGdplayer(url: URL, embed: Embed): Promise<Stream[]> {
  // A fresh token every time: they belong to the page instance.
  const found = await resolveGdplayer(url.href, `${base()}/`, EMBED_TIMEOUT_MS);
  if (found.host !== 'mp4upload') return [];
  return fromMp4upload(new URL(`https://www.mp4upload.com/embed-${found.id}.html`), embed);
}

const host = (url: URL, name: string): boolean => url.hostname === name || url.hostname.endsWith(`.${name}`);

/** HLS first, then the mp4s (B-Tube, Mp4upload, Yourupload), then gdriveplayer's HLS and gdplayer's mp4upload. */
const RESOLVERS: Resolver[] = [
  {
    match: (u) => host(u, 'xtwap.top') && /\/(?:cepat2|hls)\.php$/.test(u.pathname),
    rank: 0,
    resolve: fromPlaylist,
  },
  { match: (u) => host(u, 'xtwap.top') && /\/btube3\.php$/.test(u.pathname), rank: 1, resolve: fromBtube },
  { match: (u) => host(u, 'mp4upload.com'), rank: 2, resolve: fromMp4upload },
  {
    match: (u) => /^(?:www\.)?yourupload\.[a-z]+$/.test(u.hostname) && u.pathname.startsWith('/embed/'),
    rank: 3,
    resolve: fromYourupload,
  },
  { match: (u) => host(u, 'gdriveplayer.to') && u.pathname.startsWith('/embed'), rank: 4, resolve: fromGdriveplayer },
  { match: (u) => host(u, 'gdplayer.to'), rank: 5, resolve: fromGdplayer },
];

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const url = `${base()}${episode.url}`;
  const page = (await fetchPage(url)).text;
  let embeds = readEmbeds(page, base());
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
        ? 'This episode is only on servers the app cannot play yet (gdplayer…)'
        : 'This episode has no readable server (its files may have been deleted)',
  );
}
