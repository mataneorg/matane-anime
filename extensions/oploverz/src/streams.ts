import '@matane-anime/extension-sdk/globals';
import { type Episode, type Stream, NotFoundError, ParseError } from '@matane-anime/extension-sdk';
import { assertOk, getJson } from './api';
import { splitEpisodeUrl } from './text';

// An episode carries `streamUrl`: a list of embed pages. Only hosts that can be read down to a direct video
// are returned: Blogger (googlevideo mp4) and Dailymotion (HLS). upbolt.to sits behind a Cloudflare challenge,
// filedon.co and 4meplayer have no readable API, so they are skipped (never thrown on).

const EMBED_TIMEOUT_MS = 10_000;
const BLOGGER_RPC =
  'https://www.blogger.com/_/BloggerVideoPlayerUi/data/batchexecute?rpcids=WcwnYd&source-path=%2Fvideo.g&rt=c';

/** Heights of the itags Blogger serves. */
const ITAG_HEIGHT: Record<number, number> = { 18: 360, 22: 720, 37: 1080, 59: 480, 43: 360, 34: 360, 35: 480 };

interface EmbedEntry {
  source?: unknown;
  url?: unknown;
}

interface EpisodeData {
  streamUrl?: EmbedEntry[] | null;
}

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
    // The answer also holds a SABR-only link (`sabr=1`, no itag): the player needs a protocol, not a plain GET.
    if (params.has('sabr') || !params.has('itag')) continue;
    const itag = Number(params.get('itag'));
    const quality = ITAG_HEIGHT[itag];
    found.set(url, { url, ...(quality && { quality }) });
  }
  return [...found.values()];
}

async function fromBlogger(embed: URL): Promise<Stream[]> {
  const token = embed.searchParams.get('token');
  if (!token) return [];
  const payload = JSON.stringify([[['WcwnYd', JSON.stringify([token, '', 0]), null, 'generic']]]);
  const response = await http.post(BLOGGER_RPC, `f.req=${encodeURIComponent(payload)}`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    timeoutMs: EMBED_TIMEOUT_MS,
    throwOnError: false,
  });
  assertOk(response, BLOGGER_RPC);
  const links = parseBloggerResponse(response.text);
  if (links.length === 0) throw new ParseError('Blogger gave no video: the token may have expired');
  return links.map((link) => ({
    url: link.url,
    server: 'Blogger',
    kind: 'mp4' as const,
    ...(link.quality && { quality: link.quality }),
  }));
}

async function fromDailymotion(embed: URL): Promise<Stream[]> {
  const id = embed.searchParams.get('video');
  if (!id || !/^[A-Za-z0-9]+$/.test(id)) return [];
  const url = `https://www.dailymotion.com/player/metadata/video/${id}`;
  const response = await http.get(url, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, url);
  const meta = response.json<{ qualities?: Record<string, { type?: string; url?: string }[]> }>();
  const hls = meta.qualities?.['auto']?.find((q) => typeof q.url === 'string' && /mpegurl/i.test(q.type ?? ''))?.url;
  if (!hls) throw new ParseError('Dailymotion gave no playlist');
  return [{ url: hls, server: 'Dailymotion', kind: 'hls' }];
}

/** HLS first (not tied to an IP, and adaptive); a googlevideo link expires and is bound to the IP that asked. Then by quality. */
const rank = (stream: Stream): number => (stream.kind === 'hls' ? 0 : 1);

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const { slug, number } = splitEpisodeUrl(episode.url);
  const data = (
    await getJson<{ data?: EpisodeData }>(`/series/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(number)}`)
  ).data;
  const embeds = (data?.streamUrl ?? []).filter((e): e is { source: string; url: string } => typeof e.url === 'string');

  const streams: Stream[] = [];
  const seen = new Set<string>();
  let failures = 0;
  let skipped = 0;
  for (const entry of embeds) {
    let embed: URL;
    try {
      embed = new URL(entry.url);
    } catch {
      skipped++;
      continue;
    }
    const host = embed.hostname.toLowerCase();
    try {
      let found: Stream[];
      if (host.endsWith('blogger.com')) found = await fromBlogger(embed);
      else if (host.endsWith('dailymotion.com')) found = await fromDailymotion(embed);
      else {
        skipped++;
        continue;
      }
      for (const stream of found) {
        if (seen.has(stream.url)) continue;
        seen.add(stream.url);
        streams.push(stream);
      }
    } catch (error) {
      failures++;
      log.warn(`Server ${host} failed:`, (error as Error).message);
    }
  }

  if (streams.length === 0) {
    throw new NotFoundError(
      failures > 0
        ? 'No server of this episode could be read'
        : skipped > 0
          ? 'This episode is only on servers the app cannot play yet (upbolt, filedon…)'
          : 'This episode has no server',
    );
  }
  return streams.sort((a, b) => rank(a) - rank(b) || (b.quality ?? 0) - (a.quality ?? 0));
}
