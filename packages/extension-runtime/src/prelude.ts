// Runs inside the QuickJS sandbox before the extension bundle. It turns the two raw host primitives
// (`__hostSync`, `__hostAsync`: an op name and JSON arguments in, a JSON envelope out) into the documented
// globals (packages/extension-sdk/src/globals.ts), then removes the primitives. Plain ES2020, no imports.
export const PRELUDE = String.raw`
(() => {
  'use strict';
  const hostSync = globalThis.__hostSync;
  const hostAsync = globalThis.__hostAsync;
  delete globalThis.__hostSync;
  delete globalThis.__hostAsync;

  const toError = (e) => {
    const error = new Error(e.message);
    error.name = e.name || 'ExtensionError';
    if (e.status !== undefined) error.status = e.status;
    return error;
  };
  const unwrap = (json) => {
    const result = JSON.parse(json);
    if (result.error) throw toError(result.error);
    return result.value;
  };
  const callSync = (op, args) => unwrap(hostSync(op, JSON.stringify(args)));
  const callAsync = (op, args) => hostAsync(op, JSON.stringify(args)).then(unwrap);

  const toBytes = (value, what) => {
    if (value instanceof Uint8Array) return Array.from(value);
    if (Array.isArray(value)) return value.map(Number);
    if (typeof value === 'string') return callSync('utf8.encode', [value]);
    throw new TypeError(what + ' must be a Uint8Array, an array of numbers or a string');
  };

  class HtmlElement {
    constructor(id) { this.__id = id; }
    select(selector) { return callSync('html.select', [this.__id, String(selector)]).map((id) => new HtmlElement(id)); }
    selectFirst(selector) {
      const id = callSync('html.selectFirst', [this.__id, String(selector)]);
      return id === null ? null : new HtmlElement(id);
    }
    text() { return callSync('html.text', [this.__id]); }
    html() { return callSync('html.html', [this.__id]); }
    attr(name) { const v = callSync('html.attr', [this.__id, String(name)]); return v === null ? undefined : v; }
    absUrl(name) { const v = callSync('html.absUrl', [this.__id, String(name)]); return v === null ? undefined : v; }
  }

  // ------------------------------------------------------------ URL and URLSearchParams
  // QuickJS has neither. URL parsing is the host's (WHATWG, like the app); URLSearchParams is plain JS.
  const formEncode = (s) =>
    encodeURIComponent(s).replace(/%20/g, '+').replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const formDecode = (s) => {
    try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch (_) { return s; }
  };

  class URLSearchParams {
    constructor(init) {
      this.__list = [];
      this.__onChange = null;
      if (init === undefined || init === null) return;
      if (typeof init === 'string') {
        const text = init.charAt(0) === '?' ? init.slice(1) : init;
        for (const part of text.split('&')) {
          if (part === '') continue;
          const at = part.indexOf('=');
          this.__list.push(at < 0 ? [formDecode(part), ''] : [formDecode(part.slice(0, at)), formDecode(part.slice(at + 1))]);
        }
      } else if (typeof init[Symbol.iterator] === 'function') {
        for (const pair of init) this.__list.push([String(pair[0]), String(pair[1])]);
      } else {
        for (const key of Object.keys(init)) this.__list.push([key, String(init[key])]);
      }
    }
    __changed() { if (this.__onChange) this.__onChange(); }
    append(name, value) { this.__list.push([String(name), String(value)]); this.__changed(); }
    delete(name) { this.__list = this.__list.filter((p) => p[0] !== String(name)); this.__changed(); }
    get(name) { const p = this.__list.find((q) => q[0] === String(name)); return p ? p[1] : null; }
    getAll(name) { return this.__list.filter((p) => p[0] === String(name)).map((p) => p[1]); }
    has(name) { return this.__list.some((p) => p[0] === String(name)); }
    set(name, value) {
      const key = String(name);
      const at = this.__list.findIndex((p) => p[0] === key);
      if (at < 0) this.__list.push([key, String(value)]);
      else {
        this.__list[at][1] = String(value);
        this.__list = this.__list.filter((p, i) => p[0] !== key || i === at);
      }
      this.__changed();
    }
    sort() { this.__list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); this.__changed(); }
    forEach(callback, thisArg) { for (const p of this.__list) callback.call(thisArg, p[1], p[0], this); }
    keys() { return this.__list.map((p) => p[0])[Symbol.iterator](); }
    values() { return this.__list.map((p) => p[1])[Symbol.iterator](); }
    entries() { return this.__list.map((p) => [p[0], p[1]])[Symbol.iterator](); }
    [Symbol.iterator]() { return this.entries(); }
    get size() { return this.__list.length; }
    toString() { return this.__list.map((p) => formEncode(p[0]) + '=' + formEncode(p[1])).join('&'); }
  }

  class URL {
    constructor(input, base) {
      const parts = callSync('url.parse', [String(input), base === undefined ? null : String(base)]);
      this.href = parts.href;
      this.protocol = parts.protocol;
      this.username = parts.username;
      this.password = parts.password;
      this.host = parts.host;
      this.hostname = parts.hostname;
      this.port = parts.port;
      this.pathname = parts.pathname;
      this.hash = parts.hash;
      this.origin = parts.origin;
      this.__search = parts.search;
      this.__params = null;
    }
    get search() { return this.__search; }
    set search(value) {
      const text = String(value);
      this.__search = text === '' || text === '?' ? '' : (text.charAt(0) === '?' ? text : '?' + text);
      this.__params = null;
      this.__rebuild();
    }
    get searchParams() {
      if (!this.__params) {
        const params = new URLSearchParams(this.__search);
        params.__onChange = () => { this.__search = params.toString() === '' ? '' : '?' + params.toString(); this.__rebuild(); };
        this.__params = params;
      }
      return this.__params;
    }
    __rebuild() {
      const cut = this.href.search(/[?#]/);
      this.href = (cut < 0 ? this.href : this.href.slice(0, cut)) + this.__search + this.hash;
    }
    toString() { return this.href; }
    toJSON() { return this.href; }
  }
  const makeResponse = (r) => {
    const response = Object.assign({}, r);
    response.json = () => {
      try { return JSON.parse(r.text); }
      catch (e) { const error = new Error('Response is not valid JSON: ' + e.message); error.name = 'ParseError'; throw error; }
    };
    return response;
  };

  const format = (value) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.name + ': ' + value.message;
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  };
  const logAt = (level) => (...args) => { callSync('log', [level, args.map(format)]); };

  const define = (name, value) =>
    Object.defineProperty(globalThis, name, { value: Object.freeze(value), enumerable: false, writable: false });

  define('URLSearchParams', URLSearchParams);
  define('URL', URL);

  const request = (req) => callAsync('http.request', [req]).then(makeResponse);
  define('http', {
    request,
    get: (url, options) => request(Object.assign({}, options, { url: String(url), method: 'GET' })),
    post: (url, body, options) => {
      const req = Object.assign({}, options, { url: String(url), method: 'POST' });
      if (body !== undefined && body !== null && typeof body === 'object') {
        req.body = JSON.stringify(body);
        req.headers = Object.assign({ 'content-type': 'application/json' }, req.headers);
      } else if (body !== undefined && body !== null) {
        req.body = String(body);
      }
      return request(req);
    },
  });
  define('html', { load: (body, options) => new HtmlElement(callSync('html.load', [String(body), options || {}])) });
  define('storage', {
    get: (key) => callAsync('storage.get', [String(key)]).then((v) => (v === null ? undefined : v)),
    set: (key, value) => callAsync('storage.set', [String(key), value === undefined ? null : value]).then(() => undefined),
    remove: (key) => callAsync('storage.remove', [String(key)]).then(() => undefined),
  });
  define('prefs', { get: (key) => { const v = callSync('prefs.get', [String(key)]); return v === null ? undefined : v; } });
  define('log', { debug: logAt('debug'), info: logAt('info'), warn: logAt('warn'), error: logAt('error') });
  define('console', { log: logAt('info'), info: logAt('info'), debug: logAt('debug'), warn: logAt('warn'), error: logAt('error') });
  define('crypto', {
    md5: (text) => callSync('crypto.hash', ['md5', String(text)]),
    sha1: (text) => callSync('crypto.hash', ['sha1', String(text)]),
    sha256: (text) => callSync('crypto.hash', ['sha256', String(text)]),
    aesDecrypt: (data, key, options) => {
      const o = options || {};
      const iv = o.iv === undefined || o.iv === null ? null : toBytes(o.iv, 'iv');
      return new Uint8Array(callSync('aes.decrypt', [toBytes(data, 'data'), toBytes(key, 'key'), o.mode || 'cbc', iv, o.padding !== false]));
    },
  });
  define('base64', {
    encode: (text) => callSync('base64.encode', [String(text)]),
    decode: (text) => callSync('base64.decode', [String(text)]),
    decodeBytes: (text) => new Uint8Array(callSync('base64.decodeBytes', [String(text)])),
    encodeBytes: (bytes) => callSync('base64.encodeBytes', [toBytes(bytes, 'bytes')]),
  });
  define('utf8', {
    encode: (text) => new Uint8Array(callSync('utf8.encode', [String(text)])),
    decode: (bytes) => callSync('utf8.decode', [toBytes(bytes, 'bytes')]),
  });
  define('timers', { sleep: (ms) => callAsync('sleep', [Number(ms) || 0]).then(() => undefined) });

  // ------------------------------------------------------------ entry points used by the host
  const sources = new Map();
  const sourceFor = (key) => {
    let source = sources.get(key);
    if (!source) {
      const info = globalThis.__sourceInfos[key];
      if (!info) throw new Error('Unknown source key: ' + key);
      source = globalThis.__extension.createSource(Object.assign({}, info));
      sources.set(key, source);
    }
    return source;
  };
  const envelope = (fn) => {
    try { return fn(); }
    catch (e) {
      const name = e && e.name ? String(e.name) : 'ExtensionError';
      const message = e && e.message !== undefined ? String(e.message) : String(e);
      const out = { name, message };
      if (e && typeof e.status === 'number') out.status = e.status;
      return JSON.stringify({ error: out });
    }
  };
  const value = (v) => JSON.stringify({ value: v === undefined ? null : v });

  Object.defineProperty(globalThis, '__call', {
    value: async (key, method, argsJson) => {
      try {
        const source = sourceFor(key);
        const fn = source[method];
        if (typeof fn !== 'function') {
          const e = new Error('The source does not implement ' + method);
          e.name = 'Unsupported';
          throw e;
        }
        return value(await fn.apply(source, JSON.parse(argsJson)));
      } catch (e) {
        return envelope(() => { throw e; });
      }
    },
  });
  Object.defineProperty(globalThis, '__supports', {
    value: (key, method) => envelope(() => value(typeof sourceFor(key)[method] === 'function')),
  });
  Object.defineProperty(globalThis, '__preferences', {
    value: () => envelope(() => {
      const ext = globalThis.__extension;
      return value(typeof ext.preferences === 'function' ? ext.preferences() : []);
    }),
  });
})();
`;
