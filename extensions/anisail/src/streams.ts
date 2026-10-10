import '@matane-anime/extension-sdk/globals';
import { type Episode, type Stream, NotFoundError, ParseError } from '@matane-anime/extension-sdk';
import { unpackPacked } from './packed';
import { assertOk, base, fetchPage } from './site';
import { labelHeight } from './text';

// An episode page lists its servers in `select.mirror > option[data-em]` (base64 of `<iframe src='…'>`), labelled
// with the host and the quality ("pixel 720p"): one embed per quality. The hosts that can be read down to a direct
// mp4 are pixeldrain (behind the site's popup wrapper, whose `url=` is unwrapped), dropbox (also wrapped),
// mixdrop and mp4upload. Everything else (doply/dood, lokal, buzzheavier, kturbo, abyss, vikingfile, acefile, mega)
// needs a captcha, a nonce or a decrypting proxy and is skipped, never thrown on.
// To support a new host, add a `Resolver` to RESOLVERS.

const EMBED_TIMEOUT_MS = 10_000;
/** The pages list about 40 servers, 4 qualities of each host. */
const MAX_EMBEDS = 60;

export interface Embed {
  /** The option text ("mp4 1080p", "pixel 720p"). */
  label: string;
  url: string;
}

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

/** A host the extension can read. `rank`: lower plays first at the same quality. */
interface Resolver {
  match(url: URL): boolean;
  rank: number;
  resolve(url: URL, embed: Embed): Promise<Stream[]>;
}

const decodeEntities = (text: string): string =>
  text
    .replace(/&#0*38;|&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'");

/** The servers of an episode page. A popup wrapper is replaced by the link it carries. */
export function readEmbeds(page: string): Embed[] {
  const embeds: Embed[] = [];
  for (const match of page.matchAll(/<option\b[^>]*\sdata-em="([^"]+)"[^>]*>([^<]*)</g)) {
    let iframe: string;
    try {
      iframe = base64.decode((match[1] as string).trim());
    } catch {
      continue;
    }
    const raw = /<iframe\b[^>]*?\ssrc=["']([^"']+)["']/i.exec(iframe)?.[1];
    if (!raw) continue;
    const url = unwrapEmbed(decodeEntities(raw.trim()).replace(/^\/\//, 'https://'));
    if (!/^https?:\/\//i.test(url) || embeds.some((e) => e.url === url)) continue;
    embeds.push({ url, label: (match[2] as string).replace(/\s+/g, ' ').trim() });
  }
  return embeds;
}

/** `…/utils/player/popup/?url=<real link>&token=…` → the real link; any other address stays. */
export function unwrapEmbed(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.pathname.includes('/utils/player/popup/')) return url.searchParams.get('url') ?? raw;
  } catch {
    // not an address: left as it is
  }
  return raw;
}

// ------------------------------------------------------------------ pixeldrain

function fromPixeldrain(url: URL, embed: Embed): Promise<Stream[]> {
  // `/d/<id>` links (folders) were all gone when probed: only single files are read.
  const id = /^\/u\/([A-Za-z0-9]+)\/?$/.exec(url.pathname)?.[1];
  if (!id) return Promise.resolve([]);
  const quality = labelHeight(embed.label);
  return Promise.resolve([
    { url: `https://pixeldrain.com/api/file/${id}`, server: 'Pixeldrain', kind: 'mp4', ...(quality && { quality }) },
  ]);
}

// ------------------------------------------------------------------ dropbox

/** A shared Dropbox link as a direct file: `raw=1` redirects to dl.dropboxusercontent.com. */
export function dropboxDirect(url: URL): string {
  const direct = new URL(url.href);
  direct.searchParams.delete('dl');
  direct.searchParams.set('raw', '1');
  return direct.href;
}

function fromDropbox(url: URL, embed: Embed): Promise<Stream[]> {
  if (!url.pathname.startsWith('/scl/fi/') && !url.pathname.startsWith('/s/')) return Promise.resolve([]);
  const quality = labelHeight(embed.label);
  return Promise.resolve([{ url: dropboxDirect(url), server: 'Dropbox', kind: 'mp4', ...(quality && { quality }) }]);
}

// ------------------------------------------------------------------ mixdrop

/** The mp4 in a mixdrop embed page: its packed script sets `MDCore.wurl="//<node>.mxcontent.net/v2/<id>.mp4?…"`. */
export function parseMixdropSource(page: string): string | undefined {
  const code = unpackPacked(page) ?? page;
  const wurl = /MDCore\.wurl\s*=\s*"([^"]+)"/.exec(code)?.[1];
  if (!wurl) return undefined;
  return wurl.startsWith('//') ? `https:${wurl}` : wurl;
}

async function fromMixdrop(url: URL, embed: Embed): Promise<Stream[]> {
  // The page redirects between the domains of the family. It is asked for without a Referer, and so is the file:
  // the file host answers 403 to the site's own.
  const response = await http.get(url.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, url.href);
  const src = parseMixdropSource(response.text);
  if (!src) throw new ParseError('The mixdrop player has no file');
  const quality = labelHeight(embed.label);
  return [{ url: src, server: 'Mixdrop', kind: 'mp4', ...(quality && { quality }) }];
}

// ------------------------------------------------------------------ mp4upload

/** The mp4 in an mp4upload embed page; a deleted file has none (`File was deleted`). */
export function parseMp4uploadSource(page: string): string | undefined {
  return /src:\s*"(https:\/\/[^"]+\.mp4)"/.exec(page)?.[1];
}

async function fromMp4upload(url: URL, embed: Embed): Promise<Stream[]> {
  const response = await http.get(url.href, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, url.href);
  const src = parseMp4uploadSource(response.text);
  // Deleted files happen: that is no stream, not a failure.
  if (!src) return [];
  const quality = labelHeight(embed.label);
  // The file host answers 403 to any other Referer.
  return [
    {
      url: src,
      server: 'Mp4upload',
      kind: 'mp4',
      headers: { Referer: 'https://www.mp4upload.com/' },
      ...(quality && { quality }),
    },
  ];
}

// ------------------------------------------------------------------ all of them

const host = (url: URL, name: string): boolean => url.hostname === name || url.hostname.endsWith(`.${name}`);

/** Pixeldrain and Dropbox need no request to the embed; mixdrop and mp4upload cost one each. */
const RESOLVERS: Resolver[] = [
  { match: (u) => host(u, 'pixeldrain.com'), rank: 0, resolve: fromPixeldrain },
  { match: (u) => host(u, 'dropbox.com'), rank: 1, resolve: fromDropbox },
  {
    match: (u) =>
      /(?:^|\.)(?:mixdrop\.[a-z]+|miiiixdrop\.net|mxdrop\.[a-z]+)$/.test(u.hostname) && /^\/[ef]\//.test(u.pathname),
    rank: 2,
    resolve: fromMixdrop,
  },
  { match: (u) => host(u, 'mp4upload.com'), rank: 3, resolve: fromMp4upload },
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
    (result) => result.streams.length > 0,
  );

  // The best quality first; at the same quality the hosts with the fewest requests and the most reliable first.
  const seen = new Set<string>();
  const streams = results
    .flatMap((r) => r.streams.map((stream) => ({ stream, rank: r.rank })))
    .sort((a, b) => (b.stream.quality ?? 0) - (a.stream.quality ?? 0) || a.rank - b.rank)
    .map((entry) => entry.stream)
    .filter((stream) => !seen.has(stream.url) && !!seen.add(stream.url));
  if (streams.length > 0) return streams;

  throw new NotFoundError(
    failures > 0
      ? 'No server of this episode could be read'
      : skipped > 0
        ? 'This episode is only on servers the app cannot play (doply, lokal, abyss, mega…)'
        : 'This episode has no readable server (its files may have been deleted)',
  );
}
