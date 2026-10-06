import { describe, expect, it } from 'vitest';
import { encodeResource } from './m3u8';
import { type UpstreamFetch, type UpstreamInit, createAnimeHandler, resourceUrl } from './proxy';
import { SessionStore } from './sessions';

interface Call {
  url: string;
  init: UpstreamInit;
}

/** A fake site: url -> response factory. Records every call it receives. */
function fakeSite(routes: Record<string, () => Response>): { fetchUpstream: UpstreamFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchUpstream: UpstreamFetch = async (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route) return new Response(null, { status: 404 });
    const response = route();
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  return { fetchUpstream, calls };
}

const PLAYLIST = [
  '#EXTM3U',
  '#EXTINF:2.0,',
  'seg_000.ts',
  '#EXTINF:2.0,',
  'http://cdn.test:9000/seg_001.ts',
  '#EXT-X-ENDLIST',
  '',
].join('\n');
const HEADERS = { Referer: 'https://example.test/watch', Origin: 'https://example.test' };

function setup(
  routes: Record<string, () => Response>,
  kind: 'hls' | 'file' = 'hls',
  entry = 'http://site.test/hls/index.m3u8',
) {
  const sessions = new SessionStore();
  const session = sessions.create({ entryUrl: entry, kind, headers: HEADERS });
  const site = fakeSite(routes);
  const handler = createAnimeHandler({ sessions, fetchUpstream: site.fetchUpstream });
  const get = (url: string, headers: Record<string, string> = {}, method = 'GET') =>
    handler(new Request(url, { method, headers }));
  return { sessions, session, site, handler, get };
}

describe('anime:// proxy', () => {
  it('answers 404 with a readable error code for an unknown session', async () => {
    const { get, site } = setup({});
    const response = await get('anime://play/nope/index.m3u8');
    expect(response.status).toBe(404);
    expect(response.headers.get('x-error-code')).toBe('session_not_found');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(site.calls).toHaveLength(0);
  });

  it('rewrites the playlist, sends the session headers and remembers the hosts it saw', async () => {
    const { get, site, session } = setup({
      'http://site.test/hls/index.m3u8': () =>
        new Response(PLAYLIST, { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }),
    });
    const response = await get(`anime://play/${session.id}/index.m3u8`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
    expect(site.calls[0]?.init.headers).toMatchObject(HEADERS);

    const text = await response.text();
    expect(text).toContain(resourceUrl(session.id, 'http://site.test/hls/seg_000.ts'));
    expect(text).toContain(resourceUrl(session.id, 'http://cdn.test:9000/seg_001.ts'));
    expect([...session.hostsSeen].sort()).toEqual(['cdn.test:9000', 'site.test']);
  });

  it('fetches a segment with the session headers and passes Range and the 206 answer through', async () => {
    const { get, site, session } = setup({
      'http://site.test/hls/seg_000.ts': () =>
        new Response('abc', {
          status: 206,
          headers: {
            'content-type': 'video/mp2t',
            'content-range': 'bytes 0-2/10',
            'content-length': '3',
            'set-cookie': 'a=b',
          },
        }),
    });
    const response = await get(resourceUrl(session.id, 'http://site.test/hls/seg_000.ts'), { Range: 'bytes=0-2' });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-2/10');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toBe('abc');
    expect(site.calls[0]?.init.headers).toMatchObject({ ...HEADERS, Range: 'bytes=0-2' });
  });

  it('refuses a host that never appeared in the session, without calling the site', async () => {
    const { get, site, session } = setup({});
    const response = await get(resourceUrl(session.id, 'http://elsewhere.test/x.ts'));
    expect(response.status).toBe(403);
    expect(response.headers.get('x-error-code')).toBe('host_not_allowed');
    expect(site.calls).toHaveLength(0);
  });

  it('refuses non-http URLs and malformed resource paths', async () => {
    const { get, session } = setup({});
    const file = await get(`anime://play/${session.id}/r/${encodeResource('file:///etc/passwd')}`);
    expect(file.status).toBe(400);
    const garbage = await get(`anime://play/${session.id}/r/***`);
    expect(garbage.status).toBe(400);
    expect(garbage.headers.get('x-error-code')).toBe('bad_request');
  });

  it('turns an upstream refusal into the same status with an http_<status> code', async () => {
    const { get, session } = setup({ 'http://site.test/hls/seg_000.ts': () => new Response('no', { status: 403 }) });
    const response = await get(resourceUrl(session.id, 'http://site.test/hls/seg_000.ts'));
    expect(response.status).toBe(403);
    expect(response.headers.get('x-error-code')).toBe('http_403');
  });

  it('answers 502 when the site cannot be reached', async () => {
    const sessions = new SessionStore();
    const session = sessions.create({ entryUrl: 'http://site.test/a.mp4', kind: 'file' });
    const handler = createAnimeHandler({
      sessions,
      fetchUpstream: () => Promise.reject(new TypeError('fetch failed')),
    });
    const response = await handler(new Request(`anime://play/${session.id}/media.mp4`));
    expect(response.status).toBe(502);
    expect(response.headers.get('x-error-code')).toBe('network');
  });

  it('streams a plain file without rewriting it, and answers HEAD without a body', async () => {
    const { get, session } = setup(
      {
        'http://site.test/a.mp4': () =>
          new Response('#EXTM3U-looking-bytes', { headers: { 'content-type': 'video/mp4', 'accept-ranges': 'bytes' } }),
      },
      'file',
      'http://site.test/a.mp4',
    );
    const response = await get(`anime://play/${session.id}/media.mp4`);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(await response.text()).toBe('#EXTM3U-looking-bytes');

    const head = await get(`anime://play/${session.id}/media.mp4`, {}, 'HEAD');
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('only allows GET, HEAD and CORS preflight', async () => {
    const { handler, session } = setup({});
    const post = await handler(new Request(`anime://play/${session.id}/index.m3u8`, { method: 'POST', body: 'x' }));
    expect(post.status).toBe(405);
    const options = await handler(new Request(`anime://play/${session.id}/index.m3u8`, { method: 'OPTIONS' }));
    expect(options.status).toBe(204);
    expect(options.headers.get('access-control-allow-headers')).toBe('range');
  });
});
