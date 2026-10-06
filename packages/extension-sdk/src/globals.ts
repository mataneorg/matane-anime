// Types for the host API an extension sees as globals in the sandbox. Import for the side effect:
//
//     import '@matane-anime/extension-sdk/globals';
//
// There is no `require`, `fetch`, `process` or file access.
import type { HtmlElement, HtmlLoadOptions, HttpRequest, HttpResponse } from './host';

declare global {
  const http: {
    request(request: HttpRequest): Promise<HttpResponse>;
    get(url: string, options?: Omit<HttpRequest, 'url' | 'method' | 'body'>): Promise<HttpResponse>;
    /** An object body is sent as JSON; a string is sent as is. */
    post(
      url: string,
      body?: string | Record<string, unknown>,
      options?: Omit<HttpRequest, 'url' | 'method' | 'body'>,
    ): Promise<HttpResponse>;
  };

  const html: {
    /** Parses `body`; the returned node is the document root. */
    load(body: string, options?: HtmlLoadOptions): HtmlElement;
  };

  /** Per extension, persistent. Values must be JSON. */
  const storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };

  /** The user's values for `preferences()`, read when a call starts. */
  const prefs: {
    get<T = unknown>(key: string): T | undefined;
  };

  const log: {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };

  const crypto: {
    md5(text: string): string;
    sha1(text: string): string;
    sha256(text: string): string;
    /** Binary inputs may be a `Uint8Array`, an array of numbers or a string (UTF-8). Keep them small (KBs). */
    aesDecrypt(
      data: Uint8Array | number[] | string,
      key: Uint8Array | number[] | string,
      options?: { mode?: 'cbc' | 'ctr' | 'ecb'; iv?: Uint8Array | number[] | string; padding?: boolean },
    ): Uint8Array;
  };

  const base64: {
    encode(text: string): string;
    decode(text: string): string;
    decodeBytes(text: string): Uint8Array;
    encodeBytes(bytes: Uint8Array | number[]): string;
  };

  const utf8: {
    encode(text: string): Uint8Array;
    decode(bytes: Uint8Array | number[]): string;
  };

  const timers: {
    sleep(ms: number): Promise<void>;
  };

  // The sandbox has no web APIs of its own; these two are provided. Do not add the DOM lib to an
  // extension's tsconfig: it would declare them a second time.
  class URLSearchParams implements Iterable<[string, string]> {
    constructor(init?: string | Record<string, string> | Iterable<[string, string]>);
    readonly size: number;
    append(name: string, value: string): void;
    delete(name: string): void;
    get(name: string): string | null;
    getAll(name: string): string[];
    has(name: string): boolean;
    set(name: string, value: string): void;
    sort(): void;
    forEach(callback: (value: string, name: string, params: URLSearchParams) => void): void;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    entries(): IterableIterator<[string, string]>;
    [Symbol.iterator](): IterableIterator<[string, string]>;
    toString(): string;
  }

  /** Parsed by the host (WHATWG). Components are read-only except `search` and `searchParams`. */
  class URL {
    constructor(input: string, base?: string);
    readonly href: string;
    readonly protocol: string;
    readonly username: string;
    readonly password: string;
    readonly host: string;
    readonly hostname: string;
    readonly port: string;
    readonly pathname: string;
    readonly hash: string;
    readonly origin: string;
    search: string;
    readonly searchParams: URLSearchParams;
    toString(): string;
    toJSON(): string;
  }
}

export {};
