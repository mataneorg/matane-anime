// The shapes shared by the host API (what the sandbox may call) and the app's network layer.

export interface HttpRequest {
  url: string;
  /** Default `GET`. */
  method?: 'GET' | 'POST' | 'HEAD';
  /** `Referer` and `Origin` are allowed; the host puts them on the wire. */
  headers?: Record<string, string>;
  body?: string;
  /** Default 20 000. The host may lower it. */
  timeoutMs?: number;
  /**
   * By default 4xx/5xx responses throw (`HttpError`, `NotFoundError` for 404, `RateLimitedError` for 429).
   * Set to `false` to receive them as ordinary responses.
   */
  throwOnError?: boolean;
}

/** What the network layer returns. Header names are lower-case; repeated headers are joined with ", ". */
export interface HttpResult {
  status: number;
  /** The final URL after redirects. */
  url: string;
  headers: Record<string, string>;
  text: string;
}

/** What `http.request` resolves to inside the sandbox. */
export interface HttpResponse extends HttpResult {
  json<T = unknown>(): T;
}

export interface HtmlLoadOptions {
  /** Parse as XML (case-sensitive tags, no implied elements). */
  xml?: boolean;
  /** Base for `absUrl`; defaults to the page's own URL when loaded from a response. */
  baseUrl?: string;
}

/** A node of a parsed document. The DOM stays in the host; this is a handle that lives for one call. */
export interface HtmlElement {
  select(selector: string): HtmlElement[];
  selectFirst(selector: string): HtmlElement | null;
  text(): string;
  /** Inner HTML. */
  html(): string;
  attr(name: string): string | undefined;
  /** `attr(name)` resolved against the base URL. */
  absUrl(name: string): string | undefined;
}
