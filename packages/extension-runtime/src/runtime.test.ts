import { createCipheriv } from 'node:crypto';
import type { HttpRequest, HttpResult } from '@matane-anime/extension-sdk';
import type { ExtensionManifest } from '@matane-anime/extension-sdk/manifest';
import { afterEach, describe, expect, it } from 'vitest';
import { ExtensionRuntimeError, HostError } from './errors';
import { type HostApi, type RuntimeLimits, ExtensionRuntime } from './runtime';

const manifest: ExtensionManifest = {
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  apiVersion: 1,
  type: 'anime',
  nsfw: false,
  sources: [{ key: 'en', lang: 'en', name: 'Test (EN)' }],
};

interface Harness {
  runtime: ExtensionRuntime;
  requests: HttpRequest[];
  logs: string[];
  store: Map<string, unknown>;
}

const created: ExtensionRuntime[] = [];
afterEach(() => {
  for (const runtime of created.splice(0)) runtime.dispose();
});

const ok = (text: string, init: Partial<HttpResult> = {}): HttpResult => ({
  status: 200,
  url: 'https://site.test/',
  headers: {},
  text,
  ...init,
});

/** `methods` is the body of an object literal: the source's methods. */
async function load(
  methods: string,
  options: {
    http?: (request: HttpRequest) => Promise<HttpResult>;
    limits?: Partial<RuntimeLimits>;
    preamble?: string;
  } = {},
): Promise<Harness> {
  const requests: HttpRequest[] = [];
  const logs: string[] = [];
  const store = new Map<string, unknown>();
  const host: HostApi = {
    http: async (request) => {
      requests.push(request);
      return options.http ? options.http(request) : ok('{}');
    },
    storage: {
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => void store.set(key, value),
      remove: async (key) => void store.delete(key),
    },
    log: (level, message) => void logs.push(`${level}: ${message}`),
  };
  const code = `
    ${options.preamble ?? ''}
    class NotFoundError extends Error { constructor(m) { super(m); this.name = 'NotFoundError'; } }
    class HttpError extends Error { constructor(s) { super('HTTP ' + s); this.name = 'HttpError'; this.status = s; } }
    globalThis.__extension = {
      createSource(info) { return { baseUrl: 'https://site.test', info, ${methods} }; },
      preferences() { return [{ type: 'switch', key: 'dub', label: 'Dub', default: false }]; },
    };`;
  const runtime = await ExtensionRuntime.create({
    code,
    manifest,
    host,
    hostInfo: { appName: 'Matane Anime', appVersion: '0.0.0', apiVersion: 1 },
    limits: options.limits,
  });
  created.push(runtime);
  return { runtime, requests, logs, store };
}

const failure = async (promise: Promise<unknown>): Promise<ExtensionRuntimeError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ExtensionRuntimeError);
    return error as ExtensionRuntimeError;
  }
  throw new Error('expected the call to fail');
};

describe('calls', () => {
  it('runs a source method and returns JSON', async () => {
    const { runtime } = await load(
      `async getPopular(page) { return { items: [{ url: '/a', title: 'A' + page }], hasNextPage: false, src: this.info.key }; }`,
    );
    expect(await runtime.call('en', 'getPopular', [2])).toEqual({
      items: [{ url: '/a', title: 'A2' }],
      hasNextPage: false,
      src: 'en',
    });
  });

  it('accepts synchronous methods and maps undefined to null', async () => {
    const { runtime } = await load(`getWebUrl(item) { return this.baseUrl + item.url; }, nothing() {}`);
    expect(await runtime.call('en', 'getWebUrl', [{ url: '/x' }])).toBe('https://site.test/x');
    expect(await runtime.call('en', 'nothing', [])).toBeNull();
  });

  it('bridges promises, including several host calls at once', async () => {
    const { runtime, requests } = await load(
      `async search() { const rs = await Promise.all([1, 2, 3].map((n) => http.get('https://site.test/' + n))); return rs.map((r) => r.text); }`,
      { http: async (request) => ok(new URL(request.url).pathname) },
    );
    expect(await runtime.call('en', 'search', [])).toEqual(['/1', '/2', '/3']);
    expect(requests).toHaveLength(3);
  });

  it('reports unsupported optional methods', async () => {
    const { runtime } = await load(`getLatest() { return 1; }`);
    expect(runtime.supports('en', 'getLatest')).toBe(true);
    expect(runtime.supports('en', 'resolveUrl')).toBe(false);
    expect((await failure(runtime.call('en', 'resolveUrl', ['x']))).code).toBe('unsupported');
  });

  it('exposes preferences and the values the app passes', async () => {
    const { runtime } = await load(`dub() { return prefs.get('dub') ?? 'unset'; }`);
    expect(runtime.preferences()).toEqual([{ type: 'switch', key: 'dub', label: 'Dub', default: false }]);
    expect(await runtime.call('en', 'dub', [])).toBe('unset');
    expect(await runtime.call('en', 'dub', [], { prefs: { dub: true } })).toBe(true);
  });

  it('refuses a bundle that registers nothing', async () => {
    await expect(
      ExtensionRuntime.create({
        code: 'var x = 1;',
        manifest,
        host: {} as HostApi,
        hostInfo: { appName: 'a', appVersion: '1', apiVersion: 1 },
      }),
    ).rejects.toThrow(/did not register an extension/);
  });

  it('rejects an unknown source key and a manifest for another app', async () => {
    const { runtime } = await load(`x() { return 1; }`);
    expect((await failure(runtime.call('nope', 'x', []))).message).toMatch(/Unknown source key/);
    await expect(
      ExtensionRuntime.create({
        code: '',
        manifest: { ...manifest, type: 'manga' } as unknown as ExtensionManifest,
        host: {} as HostApi,
        hostInfo: { appName: 'a', appVersion: '1', apiVersion: 1 },
      }),
    ).rejects.toThrow(/only runs extensions/);
  });
});

describe('typed errors', () => {
  it('keeps the name and status of what the extension threw', async () => {
    const { runtime } = await load(
      `a() { throw new NotFoundError('gone'); }, b() { throw new HttpError(503); }, c() { throw new TypeError('x'); }`,
    );
    const a = await failure(runtime.call('en', 'a', []));
    expect([a.code, a.errorName, a.typed, a.message]).toEqual(['extension', 'NotFoundError', 'NotFoundError', 'gone']);
    const b = await failure(runtime.call('en', 'b', []));
    expect([b.errorName, b.status]).toEqual(['HttpError', 503]);
    const c = await failure(runtime.call('en', 'c', []));
    expect([c.errorName, c.typed]).toEqual(['TypeError', undefined]);
  });
});

describe('http', () => {
  const statusOf = (status: number) => async () => ok('body', { status });

  it('sends the request the extension described and gives back text and json()', async () => {
    const { runtime, requests } = await load(
      `async x() { const r = await http.post('https://site.test/api', { q: 'one' }, { headers: { Referer: 'https://site.test/' } }); return [r.status, r.json().ok, r.text]; }`,
      { http: async () => ok('{"ok":true}') },
    );
    expect(await runtime.call('en', 'x', [])).toEqual([200, true, '{"ok":true}']);
    expect(requests[0]).toMatchObject({
      url: 'https://site.test/api',
      method: 'POST',
      body: '{"q":"one"}',
      headers: { 'content-type': 'application/json', Referer: 'https://site.test/' },
    });
  });

  it('turns error statuses into typed errors unless told not to', async () => {
    const get = `async x() { await http.get('https://site.test/'); }`;
    for (const [status, name] of [
      [404, 'NotFoundError'],
      [429, 'RateLimitedError'],
      [500, 'HttpError'],
    ] as const) {
      const { runtime } = await load(get, { http: statusOf(status) });
      const error = await failure(runtime.call('en', 'x', []));
      expect([error.errorName, error.status ?? status]).toEqual([name, status]);
    }
    const { runtime } = await load(
      `async x() { return (await http.get('https://site.test/', { throwOnError: false })).status; }`,
      { http: statusOf(503) },
    );
    expect(await runtime.call('en', 'x', [])).toBe(503);
  });

  it('only allows http and https and never reaches the host otherwise', async () => {
    const { runtime, requests } = await load(`async x(url) { return (await http.get(url)).text; }`);
    for (const url of ['file:///etc/passwd', 'ftp://site.test/', 'javascript:alert(1)', 'not a url']) {
      const error = await failure(runtime.call('en', 'x', [url]));
      expect(error.errorName, url).toBe('ExtensionError');
    }
    expect(requests).toHaveLength(0);
  });

  it('maps a failing host to NetworkError, and keeps the typed name a host chose', async () => {
    const down = await load(`async x() { await http.get('https://site.test/'); }`, {
      http: async () => {
        throw new Error('ECONNRESET');
      },
    });
    expect((await failure(down.runtime.call('en', 'x', []))).errorName).toBe('NetworkError');
    const cloudflare = await load(`async x() { await http.get('https://site.test/'); }`, {
      http: async () => {
        throw new HostError('CloudflareError', 'challenge');
      },
    });
    expect((await failure(cloudflare.runtime.call('en', 'x', []))).errorName).toBe('CloudflareError');
  });

  it('turns invalid JSON into ParseError', async () => {
    const { runtime } = await load(`async x() { return (await http.get('https://site.test/')).json(); }`, {
      http: async () => ok('<html>'),
    });
    expect((await failure(runtime.call('en', 'x', []))).errorName).toBe('ParseError');
  });
});

describe('html', () => {
  const page = `<ul><li class="a"><a href="/one">One <b>1</b></a></li><li class="a"><a href="two">Two</a></li></ul>`;

  it('selects, reads text, html and attributes, and resolves URLs', async () => {
    const { runtime } = await load(
      `x(body) { const doc = html.load(body, { baseUrl: 'https://site.test/anime/' });
         const items = doc.select('li.a');
         return { n: items.length,
           texts: items.map((li) => li.selectFirst('a').text()),
           href: items.map((li) => li.selectFirst('a').attr('href')),
           abs: items.map((li) => li.selectFirst('a').absUrl('href')),
           inner: items[0].selectFirst('a').html(),
           none: doc.selectFirst('table'), noAttr: items[0].attr('data-x') ?? null }; }`,
    );
    expect(await runtime.call('en', 'x', [page])).toEqual({
      n: 2,
      texts: ['One 1', 'Two'],
      href: ['/one', 'two'],
      abs: ['https://site.test/one', 'https://site.test/anime/two'],
      inner: 'One <b>1</b>',
      none: null,
      noAttr: null,
    });
  });

  it('parses XML when asked', async () => {
    const { runtime } = await load(
      `x() { return html.load('<Feed><Item id="1"/><Item id="2"/></Feed>', { xml: true }).select('Item').map((i) => i.attr('id')); }`,
    );
    expect(await runtime.call('en', 'x', [])).toEqual(['1', '2']);
  });

  it('drops nodes when the call ends', async () => {
    const { runtime } = await load(
      `keep() { globalThis.saved = html.load('<p>x</p>').selectFirst('p'); return 1; }, use() { return globalThis.saved.text(); }`,
    );
    await runtime.call('en', 'keep', []);
    expect((await failure(runtime.call('en', 'use', []))).message).toMatch(/no longer available/);
  });
});

describe('URL and URLSearchParams', () => {
  it('parses and resolves URLs like the app does', async () => {
    const { runtime } = await load(
      `x() { const u = new URL('../b/c?x=1&y=two#top', 'https://site.test/a/z/');
         let bad = false; try { new URL('not a url'); } catch (e) { bad = true; }
         return { href: u.href, origin: u.origin, host: u.host, path: u.pathname, search: u.search, hash: u.hash,
                  x: u.searchParams.get('x'), y: u.searchParams.get('y'), nothing: u.searchParams.get('z'), bad }; }`,
    );
    expect(await runtime.call('en', 'x', [])).toEqual({
      href: 'https://site.test/a/b/c?x=1&y=two#top',
      origin: 'https://site.test',
      host: 'site.test',
      path: '/a/b/c',
      search: '?x=1&y=two',
      hash: '#top',
      x: '1',
      y: 'two',
      nothing: null,
      bad: true,
    });
  });

  it('builds and edits query strings, and keeps the URL in step', async () => {
    const { runtime } = await load(
      `x() { const p = new URLSearchParams({ q: 'a b&c', page: 2 }); p.append('genre', 'x'); p.append('genre', '-y'); p.set('page', 3);
         const u = new URL('https://site.test/search?old=1#h'); u.searchParams.set('q', 'naruto shippuden'); u.searchParams.delete('old');
         return { s: p.toString(), all: p.getAll('genre'), has: p.has('q'), size: p.size, keys: [...p.keys()],
                  parsed: [...new URLSearchParams('?a=1&b=%C3%A9&c=x+y').entries()], href: u.href, search: u.search }; }`,
    );
    expect(await runtime.call('en', 'x', [])).toEqual({
      s: 'q=a+b%26c&page=3&genre=x&genre=-y',
      all: ['x', '-y'],
      has: true,
      size: 4,
      keys: ['q', 'page', 'genre', 'genre'],
      parsed: [
        ['a', '1'],
        ['b', 'é'],
        ['c', 'x y'],
      ],
      href: 'https://site.test/search?q=naruto+shippuden#h',
      search: '?q=naruto+shippuden',
    });
  });
});

describe('host helpers', () => {
  it('stores values per extension and logs', async () => {
    const { runtime, store, logs } = await load(
      `async x() { await storage.set('k', { a: [1, 2] }); log.info('hello', { n: 1 }); console.warn('careful');
         const v = await storage.get('k'); const missing = await storage.get('nope'); await storage.remove('k');
         return [v, missing === undefined]; }`,
    );
    expect(await runtime.call('en', 'x', [])).toEqual([{ a: [1, 2] }, true]);
    expect(store.size).toBe(0);
    expect(logs).toEqual(['info: hello {"n":1}', 'warn: careful']);
  });

  it('hashes, encodes and decodes', async () => {
    const { runtime } = await load(
      `x() { return { md5: crypto.md5('abc'), sha1: crypto.sha1('abc'), sha256: crypto.sha256('abc'),
         b64: base64.encode('héllo'), back: base64.decode(base64.encode('héllo')),
         bytes: Array.from(utf8.encode('é')), text: utf8.decode([0xc3, 0xa9]),
         raw: Array.from(base64.decodeBytes('AQID')), enc: base64.encodeBytes(new Uint8Array([1, 2, 3])) }; }`,
    );
    expect(await runtime.call('en', 'x', [])).toEqual({
      md5: '900150983cd24fb0d6963f7d28e17f72',
      sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      b64: 'aMOpbGxv',
      back: 'héllo',
      bytes: [195, 169],
      text: 'é',
      raw: [1, 2, 3],
      enc: 'AQID',
    });
  });

  it('decrypts AES like the sites that obfuscate their embeds', async () => {
    const key = Buffer.alloc(16, 7);
    const iv = Buffer.alloc(16, 9);
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    const data = Buffer.concat([cipher.update('https://cdn.test/video.m3u8', 'utf8'), cipher.final()]);
    const { runtime } = await load(
      `x(data, key, iv) { return utf8.decode(crypto.aesDecrypt(base64.decodeBytes(data), key, { mode: 'cbc', iv })); },
       bad() { return crypto.aesDecrypt([1, 2, 3], [1, 2, 3]); }`,
    );
    expect(await runtime.call('en', 'x', [data.toString('base64'), [...key], [...iv]])).toBe(
      'https://cdn.test/video.m3u8',
    );
    expect((await failure(runtime.call('en', 'bad', []))).message).toMatch(/key must be 16, 24 or 32 bytes/);
  });

  it('sleeps through the host', async () => {
    const { runtime } = await load(`async x() { await timers.sleep(20); return 'done'; }`);
    expect(await runtime.call('en', 'x', [])).toBe('done');
  });
});

describe('sandbox', () => {
  it('has no way out: no require, process, fetch or the raw host primitives', async () => {
    const { runtime } = await load(
      `x() { return ['require', 'process', 'fetch', 'XMLHttpRequest', 'WebSocket', 'setTimeout', 'Buffer', 'module', 'import',
         '__hostSync', '__hostAsync'].filter((n) => typeof globalThis[n] !== 'undefined'); },
       async y() { try { await import('node:fs'); return 'imported'; } catch (e) { return 'blocked'; } }`,
    );
    expect(await runtime.call('en', 'x', [])).toEqual([]);
    expect(await runtime.call('en', 'y', [])).toBe('blocked');
  });

  it('freezes the host API so an extension cannot rewire it', async () => {
    const { runtime } = await load(
      `x() { const frozen = Object.isFrozen(http) && Object.isFrozen(storage);
         let replaced = false; try { globalThis.http = {}; replaced = typeof http.get !== 'function'; } catch (e) {}
         return [frozen, replaced]; }`,
    );
    expect(await runtime.call('en', 'x', [])).toEqual([true, false]);
  });

  it('allows eval inside the sandbox (packed scripts need it)', async () => {
    const { runtime } = await load(`x() { return eval('1 + 2'); }`);
    expect(await runtime.call('en', 'x', [])).toBe(3);
  });

  it('interrupts code that never returns, and unloads the runtime', async () => {
    for (const method of [`x() { while (true) {} }`, `async x() { for (;;) {} }`]) {
      const { runtime } = await load(method, { limits: { syncMs: 150 } });
      expect((await failure(runtime.call('en', 'x', []))).code).toBe('interrupted');
      expect(runtime.isDisposed).toBe(true);
    }
  });

  it('interrupts a loop that starts after an await (a promise job)', async () => {
    const { runtime } = await load(`async x() { await timers.sleep(1); while (true) {} }`, { limits: { syncMs: 150 } });
    expect((await failure(runtime.call('en', 'x', []))).code).toBe('interrupted');
  });

  it('stops an extension that uses too much memory', async () => {
    const { runtime } = await load(`x() { const a = []; for (;;) a.push({ s: 'v'.repeat(1000) + a.length }); }`, {
      limits: { memoryBytes: 4 * 1024 * 1024 },
    });
    expect((await failure(runtime.call('en', 'x', []))).code).toBe('memory');
    expect(runtime.isDisposed).toBe(true);
  });

  it('enforces a hard cap even for allocations the QuickJS limit does not count', async () => {
    // `new Array(n).fill(v)` in a loop slips under setMemoryLimit in this build (150 MB under a 4 MB limit).
    const { runtime } = await load(`x() { const a = []; for (;;) a.push(new Array(10000).fill('x')); }`, {
      limits: { memoryBytes: 4 * 1024 * 1024 },
    });
    expect((await failure(runtime.call('en', 'x', []))).code).toBe('memory');
  });

  it('times out a call that waits too long', async () => {
    const { runtime } = await load(`async x() { await timers.sleep(5000); }`, { limits: { callTimeoutMs: 100 } });
    const error = await failure(runtime.call('en', 'x', []));
    expect(error.code).toBe('timeout');
    expect(error.message).toMatch(/did not finish/);
  });

  it('gives getEpisodes its own, longer budget', async () => {
    const { runtime } = await load(
      `async getEpisodes() { await timers.sleep(150); return []; }, async getPopular() { await timers.sleep(150); }`,
      {
        limits: { callTimeoutMs: 50, methodTimeoutMs: { getEpisodes: 2000 } },
      },
    );
    expect(await runtime.call('en', 'getEpisodes', [])).toEqual([]);
    expect((await failure(runtime.call('en', 'getPopular', []))).code).toBe('timeout');
  });

  it('fails calls in flight when the runtime is disposed, and refuses new ones', async () => {
    const { runtime } = await load(`async x() { await timers.sleep(5000); }`);
    const pending = failure(runtime.call('en', 'x', []));
    runtime.dispose();
    expect((await pending).code).toBe('disposed');
    expect((await failure(runtime.call('en', 'x', []))).code).toBe('disposed');
  });

  it('survives a promise job that grows WASM memory, and still disposes cleanly', async () => {
    const { runtime } = await load(
      `async x() { await timers.sleep(1); const big = new Array(300000).fill('abcdefghij'); await timers.sleep(1); return big.length; }`,
    );
    expect(await runtime.call('en', 'x', [])).toBe(300000);
    expect(runtime.memoryUsage()).toBeGreaterThan(0);
    expect(() => runtime.dispose()).not.toThrow();
  });

  it('rejects a result that is far too large', async () => {
    const { runtime } = await load(`x() { return 'x'.repeat(40 * 1024 * 1024); }`, {
      limits: { memoryBytes: 256 * 1024 * 1024 },
    });
    expect((await failure(runtime.call('en', 'x', []))).code).toBe('invalid_result');
  });
});
