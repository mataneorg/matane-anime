import '@matane-anime/extension-sdk/globals';
import {
  type Episode,
  type HtmlElement,
  type Stream,
  type StreamKind,
  NotFoundError,
  ParseError,
} from '@matane-anime/extension-sdk';
import { unpackPacked } from './text';
import { assertOk, base, fetchPage } from './site';

// The episode page lists mirrors as buttons. A button carries base64 JSON ({ id, i, q }); the page's own
// script turns it into an iframe with two POSTs to admin-ajax.php: a nonce, then the embed. Here the same
// steps run, then each iframe is read down to a direct video URL.

/** The whole call has 30 s; stop starting new mirrors after this, once there is something to return. */
const BUDGET_MS = 20_000;
const AJAX_TIMEOUT_MS = 10_000;
const IFRAME_TIMEOUT_MS = 15_000;

interface MirrorRequest {
  id: number;
  i: number;
  q: string;
}

interface Mirror {
  label: string;
  /** Height in pixels, from the `m720p` class of the list the button is in. */
  quality?: number;
  request: MirrorRequest;
}

export interface AjaxConfig {
  nonceAction: string;
  embedAction: string;
}

/**
 * The action names live in the page's inline script and may change with the theme, so they are read, never
 * hardcoded: the nonce is requested with `data:{action:"…"}` alone, the embed with `{...e,nonce,action:"…"}`.
 */
export function readAjaxConfig(source: string): AjaxConfig | null {
  const nonceAction = /data:\{action:"([0-9a-f]{32})"\}/.exec(source)?.[1];
  const actions = [...source.matchAll(/action:"([0-9a-f]{32})"/g)].map((match) => match[1] as string);
  const embedAction = actions.find((action) => action !== nonceAction);
  if (!nonceAction || !embedAction) return null;
  return { nonceAction, embedAction };
}

function readMirrors(doc: HtmlElement): Mirror[] {
  const mirrors: Mirror[] = [];
  for (const list of doc.select('.mirrorstream ul')) {
    const height = /\bm(\d+)p\b/.exec(list.attr('class') ?? '')?.[1];
    for (const button of list.select('li a[data-content]')) {
      try {
        const request = JSON.parse(base64.decode(button.attr('data-content') ?? '')) as Partial<MirrorRequest>;
        if (typeof request.id !== 'number' || typeof request.i !== 'number' || typeof request.q !== 'string') {
          throw new Error('unexpected shape');
        }
        mirrors.push({
          label: button.text().trim(),
          ...(height && { quality: Number(height) }),
          request: { id: request.id, i: request.i, q: request.q },
        });
      } catch (error) {
        log.warn('Skipping a mirror button with unreadable data-content:', (error as Error).message);
      }
    }
  }
  // Best quality first, so the budget cuts the least useful mirrors.
  return mirrors.sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0));
}

interface Resolved {
  url: string;
  kind: StreamKind;
}

const kindOf = (url: string): StreamKind => (/\.m3u8(?:[?#]|$)/i.test(url) ? 'hls' : 'mp4');

/** A player page that is not a player: a file host with client-side encryption, or the "maintenance" image. */
export function isUnplayable(iframe: URL): boolean {
  const host = iframe.hostname.toLowerCase();
  return /(?:^|\.)mega\.(?:nz|io)$/.test(host) || iframe.pathname.startsWith('/maintenance');
}

const unquote = (text: string): string => text.replace(/\\\//g, '/');
/** Only a relative link is resolved: an absolute one is left as the player wrote it. */
const absolute = (link: string, iframe: URL): string =>
  /^https?:\/\//i.test(link) ? link : new URL(link, iframe.href).href;

/** VidHide / EarnVids: the player config is packed; the HLS links are `hls2`, `hls3`, `hls4`…, best last. */
function fromPacked(text: string, iframe: URL): Resolved | null {
  const code = unpackPacked(text);
  if (!code) return null;
  let best: { rank: number; url: string } | undefined;
  for (const match of code.matchAll(/"hls(\d+)":"([^"]+)"/g)) {
    const rank = Number(match[1]);
    if (!best || rank > best.rank) best = { rank, url: unquote(match[2] as string) };
  }
  if (!best) {
    const file = /file\s*:\s*"([^"]+\.m3u8[^"]*)"/.exec(code)?.[1];
    if (!file) return null;
    best = { rank: 0, url: unquote(file) };
  }
  return { url: absolute(best.url, iframe), kind: 'hls' };
}

const fromVideoConst = (text: string): Resolved | null => {
  const url = /const videoURL\s*=\s*"([^"]+)"/.exec(text)?.[1];
  return url ? { url, kind: kindOf(url) } : null;
};

const fromPlayerFile = (text: string): Resolved | null => {
  const url = /file\s*:\s*"(https?:[^"]+)"/.exec(text)?.[1];
  return url ? { url: unquote(url), kind: kindOf(url) } : null;
};

/** `<video><source src>`; the link sits in an attribute, so `&amp;` is the only entity to undo. */
function fromVideoTag(text: string, iframe: URL): Resolved | null {
  const src = /<(?:source|video)\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/i.exec(text)?.[1];
  if (!src) return null;
  const url = absolute(src.replace(/&(?:amp|#0*38);/g, '&'), iframe);
  return { url, kind: kindOf(url) };
}

const fromAnyLink = (text: string): Resolved | null => {
  const url = /(https?:[^"'\s<>\\]+\.(?:m3u8|mp4)[^"'\s<>\\]*)/i.exec(text)?.[1];
  return url ? { url: url.replace(/&amp;/g, '&'), kind: kindOf(url) } : null;
};

/**
 * The player decides how the video URL is found, and the label on the button does not say which player it is
 * ("odstream" is sometimes archive.org, sometimes googlevideo), so this goes by the iframe's own URL. A host
 * we have never seen falls through to the generic readers, from most to least specific.
 */
export function resolveIframe(iframe: URL, text: string): Resolved | null {
  const path = iframe.pathname;
  if (path.startsWith('/dstream/odcdn/')) return fromVideoConst(text) ?? fromAnyLink(text);
  if (path.startsWith('/dstream/arcg/')) return fromPlayerFile(text) ?? fromAnyLink(text);
  if (path.startsWith('/dstream/ondesu/') || path.startsWith('/dstream/otakuwatch7/')) {
    return fromVideoTag(text, iframe) ?? fromAnyLink(text);
  }
  return (
    fromPacked(text, iframe) ??
    fromVideoConst(text) ??
    fromVideoTag(text, iframe) ??
    fromPlayerFile(text) ??
    fromAnyLink(text)
  );
}

/** Direct, stable hosts first; a googlevideo link expires and is tied to the IP that asked for it. */
function rank(stream: Stream): number {
  const host = new URL(stream.url).hostname;
  if (host.endsWith('odcloud.net')) return 0;
  if (host.endsWith('archive.org')) return 1;
  if (stream.kind === 'hls') return 2;
  if (host.endsWith('googlevideo.com')) return 4;
  return 3;
}

const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' };

/** The two admin-ajax calls of the player. Everything is a form POST: an object body would go out as JSON, which the site answers with 400. */
function createAjax(config: AjaxConfig, pageUrl: string) {
  // The script names its own host, but the site address is the user's to set; the path is what matters.
  const endpoint = `${base()}/wp-admin/admin-ajax.php`;
  const post = (fields: Record<string, string>) =>
    http.post(endpoint, new URLSearchParams(fields).toString(), {
      headers: { ...FORM_HEADERS, Referer: pageUrl },
      timeoutMs: AJAX_TIMEOUT_MS,
      throwOnError: false,
    });

  let nonce: string | undefined;
  const fetchNonce = async (): Promise<string> => {
    const reply = await post({ action: config.nonceAction });
    assertOk(reply, endpoint);
    const value = reply.json<{ data?: unknown }>().data;
    if (typeof value !== 'string' || !value) throw new ParseError('admin-ajax returned no nonce');
    return value;
  };

  /** The iframe URL of one mirror; `undefined` when the nonce was refused even after a fresh one. */
  return async (request: MirrorRequest): Promise<string | undefined> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      nonce ??= await fetchNonce();
      const reply = await post({
        id: String(request.id),
        i: String(request.i),
        q: request.q,
        nonce,
        action: config.embedAction,
      });
      if (reply.status === 403 && attempt === 0) {
        nonce = undefined; // rotated; ask once more, never loop
        continue;
      }
      if (reply.status === 400 || reply.status === 403) return undefined; // the protocol was refused
      assertOk(reply, endpoint);
      const data = reply.json<{ data?: unknown }>().data;
      if (typeof data !== 'string') throw new ParseError('admin-ajax returned no embed');
      return html.load(base64.decode(data)).selectFirst('iframe')?.attr('src') ?? undefined;
    }
    return undefined;
  };
}

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const startedAt = Date.now();
  const pageUrl = `${base()}${episode.url}`;
  const { response, moved } = await fetchPage(pageUrl);
  if (moved) throw new NotFoundError(`The episode page is gone: ${pageUrl}`);
  const doc = html.load(response.text, { baseUrl: pageUrl });
  const mirrors = readMirrors(doc);
  const config = readAjaxConfig(response.text);
  const embedFor = config ? createAjax(config, pageUrl) : undefined;
  const referer = `${base()}/`;

  const resolved = new Map<string, Resolved | null>();
  const resolveSrc = async (src: string): Promise<Resolved | null> => {
    const iframe = new URL(src, pageUrl);
    if (isUnplayable(iframe)) return null;
    const known = resolved.get(iframe.href);
    if (known !== undefined) return known;
    const player = await http.get(iframe.href, {
      headers: { Referer: referer },
      timeoutMs: IFRAME_TIMEOUT_MS,
      throwOnError: false,
    });
    assertOk(player, iframe.href);
    const result = resolveIframe(iframe, player.text);
    resolved.set(iframe.href, result);
    return result;
  };

  const streams: Stream[] = [];
  const seen = new Set<string>();
  const add = (found: Resolved, iframe: URL, label: string, quality: number | undefined): void => {
    if (seen.has(found.url)) return;
    seen.add(found.url);
    streams.push({
      url: found.url,
      server: (label || iframe.hostname).slice(0, 100),
      ...(quality && { quality }),
      kind: found.kind,
      headers: { Referer: `${iframe.origin}/` },
    });
  };

  let failures = 0;
  let refused = false;
  if (embedFor) {
    for (const mirror of mirrors) {
      if (streams.length > 0 && Date.now() - startedAt > BUDGET_MS) {
        log.warn('Out of time; leaving the remaining mirrors');
        break;
      }
      const label = `${mirror.label || 'mirror'} ${mirror.request.q}`.trim();
      try {
        const src = await embedFor(mirror.request);
        if (src === undefined) {
          refused = true;
          continue;
        }
        const found = await resolveSrc(src);
        if (found) add(found, new URL(src, pageUrl), label, mirror.quality);
      } catch (error) {
        failures++;
        log.warn(`Mirror ${label} failed:`, (error as Error).message);
      }
    }
  }

  // The page's own iframe is the last resort: it is whatever the site picked, and it may be a dead host.
  if (streams.length === 0) {
    const src = doc.selectFirst('#pembed iframe')?.attr('src');
    if (src) {
      try {
        const found = await resolveSrc(src);
        if (found) add(found, new URL(src, pageUrl), 'default', undefined);
      } catch (error) {
        log.warn('The default player failed:', (error as Error).message);
      }
    }
  }

  if (streams.length === 0) {
    if (mirrors.length > 0 && !config) throw new ParseError('The admin-ajax actions were not found: the theme changed');
    if (refused) throw new ParseError('admin-ajax refused the nonce: the player protocol changed');
    throw new NotFoundError(
      failures > 0 ? 'No server of this episode could be read' : 'This episode has no server that can be played',
    );
  }
  return streams.sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0) || rank(a) - rank(b));
}
