import '@matane-anime/extension-sdk/globals';
import { type Episode, type Stream, NotFoundError, ParseError } from '@matane-anime/extension-sdk';
import { assertOk, base, fetchPage } from './site';
import { isDub } from './text';

// An episode page lists its servers in `div#w-servers .type[data-type] li.player-type-link[data-src]`; each
// `data-src` is a wrapper page on the site (`/player/?source=blogger|embed&url=<opaque>`) that is fetched with the
// episode page as Referer:
//   SD  (source=blogger): an inline `var fileUrl = "https://rr…googlevideo.com/videoplayback?…"` (mp4, 360p; the
//        address redirects to another host at play time).
//   HD  (source=embed): an iframe to megaplay.su, whose page names an HLS media playlist; English HARDSUB, so the
//        subtitles are in the picture.
//   Mega (source=embed): an iframe to megavid.buzz/mal/<id>/<ep>/<sub|dub>, whose `/source` JSON names the HLS
//        master (the upstream of animex.one). Its subtitles are separate tracks the SDK cannot pass, so for a sub
//        it comes last; for a dub (a real English dub) it comes first.

const PLAYER_TIMEOUT_MS = 10_000;

type Kind = 'sd' | 'hd' | 'mega';

interface Server {
  type: 'sub' | 'dub';
  label: string;
  src: string;
}

const decodeEntities = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'");

/** The servers of an episode page, in page order. */
export function readServers(page: string): Server[] {
  const servers: Server[] = [];
  for (const block of page.matchAll(/<div class="type" data-type="(sub|dub)">([\s\S]*?)<\/ul>/g)) {
    for (const item of (block[2] as string).matchAll(/<li class="player-type-link" data-src="([^"]+)">([^<]*)</g)) {
      const src = decodeEntities(item[1] as string).trim();
      if (/^https:\/\/[^/]+\/player\/\?/.test(src)) {
        servers.push({ type: block[1] as 'sub' | 'dub', label: (item[2] as string).trim(), src });
      }
    }
  }
  return servers;
}

/** The mp4 of an SD wrapper page: `var fileUrl = "https://rr…googlevideo.com/videoplayback?…"` (JS-escaped). */
export function parseFileUrl(page: string): string | undefined {
  const raw = /var fileUrl\s*=\s*"(https:[^"]*googlevideo\.com\/videoplayback[^"]*)"/.exec(page)?.[1];
  return raw?.replace(/\\u0026|\\x26|&amp;/gi, '&').replace(/\\\//g, '/');
}

/** The iframe address of an HD/Mega wrapper page. */
export function parseIframe(page: string): string | undefined {
  const src = /<iframe\b[^>]*?\ssrc="([^"]+)"/i.exec(page)?.[1];
  return src ? decodeEntities(src).replace(/^\/\//, 'https://') : undefined;
}

/** The HLS media playlist of a megaplay.su embed page. */
export function parseMegaplayPlaylist(page: string): string | undefined {
  return /https:\/\/megaplay\.su\/uploads\/hls\/[^"'\s\\]+\.m3u8[^"'\s\\]*/.exec(page.replace(/\\\//g, '/'))?.[0];
}

async function wrapper(server: Server, referer: string): Promise<string> {
  const response = await http.get(server.src, {
    headers: { Referer: referer },
    timeoutMs: PLAYER_TIMEOUT_MS,
    throwOnError: false,
  });
  assertOk(response, server.src);
  return response.text;
}

async function fromSd(server: Server, referer: string): Promise<Stream> {
  const url = parseFileUrl(await wrapper(server, referer));
  if (!url) throw new ParseError('The SD player has no video');
  return { url, server: 'SD', kind: 'mp4', quality: 360 };
}

async function fromEmbed(server: Server, referer: string): Promise<{ stream: Stream; kind: Kind }> {
  const iframe = parseIframe(await wrapper(server, referer));
  if (!iframe) throw new ParseError('The player page has no iframe');
  const target = new URL(iframe);
  if (target.hostname === 'megaplay.su' || target.hostname.endsWith('.megaplay.su')) {
    const response = await http.get(target.href, { timeoutMs: PLAYER_TIMEOUT_MS, throwOnError: false });
    assertOk(response, target.href);
    const url = parseMegaplayPlaylist(response.text);
    if (!url) throw new ParseError('The megaplay page has no playlist');
    // The playlist is served with a wrong type: it is HLS whatever the headers say.
    return { stream: { url, server: 'HD', kind: 'hls' }, kind: 'hd' };
  }
  if (target.hostname === 'megavid.buzz' && /^\/mal\/\d+\/[\d.]+\/(?:sub|dub)\/?$/.test(target.pathname)) {
    const source = `${target.origin}${target.pathname.replace(/\/$/, '')}/source`;
    const response = await http.get(source, { timeoutMs: PLAYER_TIMEOUT_MS, throwOnError: false });
    assertOk(response, source);
    const answer = response.json<{ status?: string; source?: string }>();
    if (answer.status !== 'ok' || !answer.source || !/^https:\/\//.test(answer.source)) {
      throw new ParseError('The megavid source gave no playlist');
    }
    return { stream: { url: answer.source, server: 'Mega', kind: 'hls' }, kind: 'mega' };
  }
  throw new ParseError(`An unknown player host: ${target.hostname}`);
}

/** The sub: the hardsub HD first, then SD, then Mega (soft subtitles). The dub: Mega, then SD. */
const RANK: Record<'sub' | 'dub', Record<Kind, number>> = {
  sub: { hd: 0, sd: 1, mega: 2 },
  dub: { mega: 0, hd: 1, sd: 2 },
};

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const referer = `${base()}${episode.url}`;
  const page = (await fetchPage(referer)).text;
  const all = readServers(page);
  // The dub episodes (separate series) list a `dub` block, the sub episodes a `sub` block.
  const wanted = isDub(episode.url) ? 'dub' : 'sub';
  const servers = all.filter((s) => s.type === wanted).concat(all.filter((s) => s.type !== wanted));
  if (servers.length === 0) throw new NotFoundError('This episode has no server');

  let failures = 0;
  const results = await Promise.all(
    servers.map(async (server) => {
      try {
        if (/[?&]source=blogger\b/.test(server.src))
          return { kind: 'sd' as Kind, stream: await fromSd(server, referer), type: server.type };
        if (/[?&]source=embed\b/.test(server.src)) return { ...(await fromEmbed(server, referer)), type: server.type };
        return undefined;
      } catch (error) {
        log.warn(`Server ${server.label} failed:`, (error as Error).message);
        failures++;
        return undefined;
      }
    }),
  );
  const seen = new Set<string>();
  const streams = results
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => (a.type === b.type ? 0 : a.type === wanted ? -1 : 1) || RANK[wanted][a.kind] - RANK[wanted][b.kind])
    .map((r) => r.stream)
    .filter((stream) => !seen.has(stream.url) && !!seen.add(stream.url));
  if (streams.length > 0) return streams;
  throw new NotFoundError(
    failures > 0 ? 'No server of this episode could be read' : 'This episode has no readable server',
  );
}
