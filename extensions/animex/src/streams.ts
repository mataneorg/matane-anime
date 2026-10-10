import '@matane-anime/extension-sdk/globals';
import { type Episode, type Stream, NotFoundError, ParseError } from '@matane-anime/extension-sdk';
import { getJson, streamsUrl } from './api';
import { splitEpisodeUrl } from './text';

// `GET /rest/api/servers?id&epNum` lists the providers that have the episode (separately for sub and dub);
// `GET /rest/api/sources?id&epNum&type&providerId` gives an HLS master and the headers it wants. Each provider that
// answers becomes a stream. The CDNs refuse a request without those headers (master, variants and segments), and the
// app applies the stream's headers to all of them.
//
// Sub and dub: the SDK has no subtitle field, so a provider whose sub is a separate soft track (yuki, sora, zuna)
// plays without visible subtitles. The providers "nero" and "loli" ("Sub and dub" in the site's own words) ship the
// sub without separate tracks, i.e. as the picture, so they are offered first for the sub.

const SOURCE_TIMEOUT_MS = 10_000;
/** Once the best provider has given a stream, the others get this long to answer: one that hangs does not hold it back. */
const GRACE_MS = 2_500;

/** The site's order of preference, adapted: the providers that need no subtitle track first. */
const PROVIDERS = ['nero', 'loli', 'yuki', 'zuna', 'sora'] as const;
type Provider = (typeof PROVIDERS)[number];

interface ServersAnswer {
  subProviders?: { id?: string }[];
  dubProviders?: { id?: string }[];
}

interface SourcesAnswer {
  sources?: { url?: string; quality?: string; type?: string }[];
  tracks?: unknown[] | null;
  headers?: Record<string, string> | null;
}

/** Only the headers the SDK lets through, and the Origin the krussdomi CDN checks (the answer omits it). */
export function streamHeaders(url: string, given: Record<string, string> | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(given ?? {})) {
    if (/^(?:origin|referer)$/i.test(name) && typeof value === 'string' && value) {
      headers[name.toLowerCase() === 'origin' ? 'Origin' : 'Referer'] = value;
    }
  }
  if (/^https:\/\/(?:[\w-]+\.)?krussdomi\.com\//.test(url)) {
    headers['Origin'] = 'https://krussdomi.com';
    headers['Referer'] = 'https://krussdomi.com/';
  }
  return headers;
}

async function fromProvider(
  id: string,
  number: string,
  type: 'sub' | 'dub',
  provider: Provider,
): Promise<Stream | undefined> {
  const answer = await getJson<SourcesAnswer>(
    streamsUrl(),
    '/rest/api/sources',
    { id, epNum: number, type, providerId: provider },
    SOURCE_TIMEOUT_MS,
  );
  const url = answer.sources?.find((s) => typeof s.url === 'string' && /^https?:\/\//.test(s.url))?.url;
  if (!url) return undefined;
  const headers = streamHeaders(url, answer.headers);
  // The CDNs label the playlists and the .jpg segments with odd types: it is HLS whatever they say.
  return { url, server: provider, kind: 'hls', ...(Object.keys(headers).length > 0 && { headers }) };
}

/**
 * The answers of `tasks` (best provider first), all of them unless one hangs: the wait ends `GRACE_MS` after the
 * first task that gave a stream, and the ones still open then are left out. Nothing is dropped while no stream has
 * arrived.
 */
async function settleInOrder(tasks: Promise<Stream | undefined>[]): Promise<(Stream | undefined)[]> {
  const answers: (Stream | undefined)[] = [];
  let deadline: number | undefined;
  for (const task of tasks) {
    if (deadline === undefined) {
      const answer = await task;
      answers.push(answer);
      if (answer) deadline = Date.now() + GRACE_MS;
    } else {
      const left = Math.max(0, deadline - Date.now());
      answers.push(await Promise.race([task, timers.sleep(left).then(() => undefined)]));
    }
  }
  return answers;
}

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const parts = splitEpisodeUrl(episode.url);
  if (!parts) throw new NotFoundError(`Not an episode of this site: ${episode.url}`);

  const servers = await getJson<ServersAnswer>(streamsUrl(), '/rest/api/servers', {
    id: parts.id,
    epNum: parts.number,
  });
  const listed = (parts.type === 'dub' ? servers.dubProviders : servers.subProviders) ?? [];
  const providers = PROVIDERS.filter((p) => listed.some((l) => l.id === p));
  if (providers.length === 0) {
    throw new NotFoundError(
      listed.length > 0
        ? 'This episode is only on servers the app does not know'
        : `This episode has no ${parts.type} yet`,
    );
  }

  let failures = 0;
  const results = await settleInOrder(
    providers.map(async (provider) => {
      try {
        return await fromProvider(parts.id, parts.number, parts.type, provider);
      } catch (error) {
        log.warn(`Server ${provider} failed:`, (error as Error).message);
        failures++;
        return undefined;
      }
    }),
  );
  const seen = new Set<string>();
  const streams = results.filter((s): s is Stream => !!s && !seen.has(s.url) && !!seen.add(s.url));
  if (streams.length > 0) return streams;
  if (failures === 0) throw new ParseError('The servers answered without a stream: the site changed');
  throw new NotFoundError('No server of this episode could be read');
}
