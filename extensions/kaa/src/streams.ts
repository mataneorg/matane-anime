import '@matane-anime/extension-sdk/globals';
import { type Episode, type Stream, NotFoundError, ParseError } from '@matane-anime/extension-sdk';
import { assertOk, getJson } from './api';
import { parseManifest } from './text';

// An episode of the API lists its `servers[]`; each `src` is a krussdomi.com player page (VidStreaming or
// CatStream) whose HTML holds the HLS master playlist. The master, its variant and audio playlists and the TS
// segments (served as .jpg) all answer 403 unless `Origin: https://krussdomi.com` is sent, so it goes in the stream
// headers, which the app applies to every request of the stream.

const PLAYER_TIMEOUT_MS = 10_000;
/** What the CDN checks (a Referer alone is not enough for the segments). */
export const STREAM_HEADERS = { Origin: 'https://krussdomi.com', Referer: 'https://krussdomi.com/' };

interface EpisodeData {
  servers?: { name?: string; src?: string }[];
}

async function fromPlayer(name: string, src: string): Promise<Stream> {
  const url = new URL(src);
  if (url.hostname !== 'krussdomi.com' && !url.hostname.endsWith('.krussdomi.com')) {
    throw new ParseError(`An unknown player host: ${url.hostname}`);
  }
  const response = await http.get(url.href, { timeoutMs: PLAYER_TIMEOUT_MS, throwOnError: false });
  assertOk(response, url.href);
  const manifest = parseManifest(response.text);
  if (!manifest) throw new ParseError('The player page has no playlist');
  return { url: manifest, server: name, kind: 'hls', headers: { ...STREAM_HEADERS } };
}

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const at = episode.url.indexOf('/');
  if (at < 1) throw new NotFoundError(`Not an episode of this site: ${episode.url}`);
  const show = episode.url.slice(0, at);
  const part = episode.url.slice(at + 1);
  const data = await getJson<EpisodeData>(`/show/${encodeURIComponent(show)}/episode/${encodeURIComponent(part)}`);
  // An episode that has no server yet (a dub that was announced, not released) lists none.
  const servers = (data.servers ?? []).filter((s): s is { name?: string; src: string } => !!s.src);
  if (servers.length === 0) throw new NotFoundError('This episode has no server yet');

  let failures = 0;
  const results = await Promise.all(
    servers.map(async (server) => {
      try {
        return await fromPlayer(server.name?.trim() || 'Server', server.src);
      } catch (error) {
        log.warn(`Server ${server.name ?? ''} failed:`, (error as Error).message);
        failures++;
        return undefined;
      }
    }),
  );
  const seen = new Set<string>();
  const streams = results.filter((s): s is Stream => !!s && !seen.has(s.url) && !!seen.add(s.url));
  if (streams.length > 0) return streams;
  throw new NotFoundError(
    failures > 0 ? 'No server of this episode could be read' : 'This episode has no readable server',
  );
}
