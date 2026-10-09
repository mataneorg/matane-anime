import '@matane-anime/extension-sdk/globals';
import { type Episode, type HtmlElement, type Stream, NotFoundError, ParseError } from '@matane-anime/extension-sdk';
import { assertOk, base, fetchPage } from './site';
import { unpackPacked } from './text';

// An episode page names its servers in plain HTML: the default player is `#pembed iframe` (the real address
// is in `data-litespeed-src`; `src` is about:blank) and some episodes add `.aspd-server` buttons whose
// `data-url` is another embed. Only hosts that can be read down to a direct video are returned:
//   Blogger (googlevideo mp4), play.xtwap.top (cepat2 HLS, btube3 mp4) and vkspeed.com (mp4).
// playerwish/hlswish (unreachable from the networks tried), turbovidhls (dead domain) and anything else are
// skipped, never thrown on.

const EMBED_TIMEOUT_MS = 10_000;
/** More servers than this are never needed: the pages list 1–3 distinct ones. */
const MAX_EMBEDS = 8;

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
    // The answer may also hold a SABR-only link (`sabr=1`, no itag): the player needs a protocol, not a plain GET.
    if (params.has('sabr') || !params.has('itag')) continue;
    const quality = ITAG_HEIGHT[Number(params.get('itag'))];
    found.set(url, { url, ...(quality && { quality }) });
  }
  return [...found.values()];
}

/** The `file`/`label` pairs of a vkspeed player config: `sources:[{file:"…/v.mp4",label:"360p"},…]`. */
export function parseVkspeedSources(page: string): { url: string; quality?: number }[] {
  const code = unpackPacked(page) ?? page;
  const found: { url: string; quality?: number }[] = [];
  for (const match of code.matchAll(/\{\s*file\s*:\s*"(https?:[^"]+)"\s*(?:,\s*label\s*:\s*"([^"]*)")?/g)) {
    const url = (match[1] as string).replace(/\\\//g, '/');
    const height = /^(\d{3,4})p?$/i.exec(match[2] ?? '')?.[1];
    found.push({ url, ...(height && { quality: Number(height) }) });
  }
  return found;
}

/** The HLS master playlist in the page of an xtwap player (a JW Player config). */
export function parseXtwapPlaylist(page: string): string | undefined {
  return /["']?file["']?\s*:\s*"(https?:[^"]+\.m3u8[^"]*)"/.exec(page)?.[1]?.replace(/\\\//g, '/');
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

/** The googlevideo mp4 in a btube3 player page: `<source src="https://…googlevideo…">` (empty when its token is dead). */
export function parseBtubeSource(page: string): string | undefined {
  const src = /<source[^>]+src="(https:\/\/[^"]*googlevideo[^"]*)"/i.exec(page)?.[1];
  return src?.replace(/&amp;/g, '&');
}

async function fromXtwap(embed: URL): Promise<Stream[]> {
  // Sent without a Referer: btube3 answers 403 to another site's.
  const response = await http.get(embed.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, embed.href);
  if (/\/btube3\.php$/.test(embed.pathname)) {
    const src = parseBtubeSource(response.text);
    if (!src) throw new ParseError('The btube player has no video (its token is dead)');
    return [{ url: src, server: 'xtwap', kind: 'mp4', quality: 360 }];
  }
  const url = parseXtwapPlaylist(response.text);
  if (!url) throw new ParseError('The xtwap player has no playlist');
  return [{ url, server: 'xtwap', kind: 'hls' }];
}

async function fromVkspeed(embed: URL): Promise<Stream[]> {
  const response = await http.get(embed.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, embed.href);
  const sources = parseVkspeedSources(response.text);
  if (sources.length === 0) throw new ParseError('The vkspeed player has no sources');
  // The video host refuses the site's Referer (403) but accepts its own player's.
  return sources.map((source) => ({
    url: source.url,
    server: 'vkspeed',
    kind: 'mp4' as const,
    ...(source.quality && { quality: source.quality }),
    headers: { Referer: 'https://vkspeed.com/' },
  }));
}

/** Server addresses of an episode page: the default iframe first, then the extra buttons; no duplicates. */
export function readEmbeds(doc: HtmlElement): string[] {
  const urls: string[] = [];
  const iframe = doc.selectFirst('#pembed iframe');
  const candidates = [
    iframe?.attr('data-litespeed-src'),
    iframe?.attr('data-src'),
    iframe?.attr('src'),
    ...doc.select('.aspd-server').map((button) => button.attr('data-url')),
  ];
  for (const candidate of candidates) {
    const url = (candidate ?? '').trim();
    if (/^https?:\/\//i.test(url) && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

async function resolve(embed: URL): Promise<Stream[] | null> {
  const host = embed.hostname.toLowerCase();
  if (host.endsWith('blogger.com')) return fromBlogger(embed);
  if (host.endsWith('xtwap.top') && /\/(?:cepat2|btube3)\.php$/.test(embed.pathname)) return fromXtwap(embed);
  if (host.endsWith('vkspeed.com')) return fromVkspeed(embed);
  return null;
}

/** Verified-working order: Blogger (best itag first), then the HLS of xtwap, then its btube mp4, then vkspeed's small mp4s. */
const rank = (stream: Stream): number =>
  stream.server === 'Blogger' ? 0 : stream.kind === 'hls' ? 1 : stream.server === 'xtwap' ? 2 : 3;

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const url = `${base()}${episode.url}`;
  const doc = html.load((await fetchPage(url)).text, { baseUrl: url });
  const embeds = readEmbeds(doc).slice(0, MAX_EMBEDS);

  const targets: URL[] = [];
  let skipped = 0;
  let failures = 0;
  for (const embed of embeds) {
    try {
      targets.push(new URL(embed));
    } catch {
      skipped++;
    }
  }

  const results = await Promise.all(
    targets.map(async (target) => {
      try {
        const found = await resolve(target);
        if (found === null) skipped++;
        return found ?? [];
      } catch (error) {
        log.warn(`Server ${target.hostname} failed:`, (error as Error).message);
        failures++;
        return [];
      }
    }),
  );

  const seen = new Set<string>();
  const streams = results
    .flat()
    .filter((stream) => !seen.has(stream.url) && !!seen.add(stream.url))
    .sort((a, b) => rank(a) - rank(b) || (b.quality ?? 0) - (a.quality ?? 0));
  if (streams.length > 0) return streams;

  throw new NotFoundError(
    failures > 0
      ? 'No server of this episode could be read'
      : skipped > 0
        ? 'This episode is only on servers the app cannot play yet (playerwish, turbovid…)'
        : 'This episode has no server',
  );
}
