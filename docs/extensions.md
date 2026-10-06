# Writing an extension for Matane Anime

> Draft for phase 1. The SDK and `ma-ext` are workspace packages for now; they are published in phase 4, together with repositories. Until then, link them from this repository.

An extension is one JavaScript file that tells the app how to read a site: what is popular, what matches a search, what an anime page and its episodes look like, and where the video is. The app does everything else: the network, the player, the library, the downloads. The contract is in [`packages/extension-sdk/src/types.ts`](../packages/extension-sdk/src/types.ts) and in docs/PRD.md §7.

Matane Anime ships no extensions and does not suggest any. What you write, and what you point it at, is up to you.

## A minimal extension

```sh
pnpm --filter @matane-anime/extension-cli build      # once, so `ma-ext` exists
ma-ext create my-site --lang en                      # scaffolds ./my-site
cd my-site && pnpm install
```

```
my-site/
  manifest.json   id, name, version, apiVersion, type: "anime", sources
  src/index.ts    export default defineExtension({ createSource })
```

`manifest.json`:

```json
{
  "id": "my-site",
  "name": "My Site",
  "version": "0.1.0",
  "apiVersion": 1,
  "type": "anime",
  "nsfw": false,
  "rateLimit": { "perSecond": 5 },
  "sources": [{ "key": "en", "lang": "en", "name": "My Site (EN)" }]
}
```

- `id` is lower-case, starts with a letter, carries no language, and **never changes**: libraries refer to it.
- A source id is `<id>/<key>`. One extension may offer several sources (languages, mirrors).
- `type` must be `"anime"`; the app refuses anything else.
- `rateLimit.perSecond` caps requests per second (default 10). Segments and media have their own, looser limit.

## The source

```ts
import '@matane-anime/extension-sdk/globals';
import { defineExtension, NotFoundError, ParseError } from '@matane-anime/extension-sdk';

export default defineExtension({
  createSource: ({ key, lang, name }) => ({
    baseUrl: 'https://example.com',
    getPopular: async (page) => { /* … */ },           // page starts at 1
    search: async (query, page, filters) => { /* … */ },
    getAnimeDetails: async (anime) => { /* … */ },
    getEpisodes: async (anime) => { /* newest first */ },
    getStreams: async (episode) => { /* one or more direct video URLs */ },
    // optional: getLatest, getFilters, resolveUrl, getWebUrl, migrateUrl
  }),
});
```

- **`url` is an identity**, usually a path relative to `baseUrl`, so a domain change does not break a library. To open a page in the browser, implement `getWebUrl`.
- **Episodes** with the same `number` count as one (Sub and Dub of episode 3); set `variant` to tell them apart. `number` may be fractional.
- **`getStreams` resolves the embeds.** It may make several requests (episode page → embed → player config) and returns direct URLs, `server` labels, `quality` (height in pixels, when you know it) and the `headers` the site wants (usually `Referer`). The app picks a stream, checks that it answers, and falls back to the next if it breaks. An empty list is a `NotFoundError`.
- Throw the typed errors, so the UI can say the right thing: `NetworkError`, `HttpError(status)`, `CloudflareError`, `RateLimitedError`, `NotFoundError`, `ParseError`.
- `getFilters` returns `text`, `select`, `checkbox`, `tristate`, `sort`, `group`, `header` and `separator` filters; the app draws them. `preferences()` declares settings (`switch`, `select`, `multiselect`, `text`) the same way; read them with `prefs.get(key)`.

## What the sandbox gives you

There is no `require`, `fetch`, `process`, file access or DOM. These globals exist (types in `@matane-anime/extension-sdk/globals`):

| Global | Use |
|---|---|
| `http.get/post/request` | Requests, through the app. Error statuses throw (`404` → `NotFoundError`, `429` → `RateLimitedError`, others `HttpError`); pass `throwOnError: false` to get them back. `Referer` and `Origin` may be set. |
| `html.load(text, { baseUrl })` | Parses HTML (cheerio, outside the sandbox). `select`, `selectFirst`, `text`, `html`, `attr`, `absUrl`. Nodes live for one call. |
| `storage`, `prefs`, `log` | Per-extension JSON storage, the user's preferences, and a log that shows in Settings → Advanced. |
| `crypto`, `base64`, `utf8` | md5/sha1/sha256, `aesDecrypt` (cbc, ctr, ecb), encoders. Keep binary values small. |
| `URL`, `URLSearchParams` | Provided; QuickJS has neither. Do not add the DOM lib to your tsconfig. |
| `timers.sleep(ms)` | Wait. |

Limits: **64 MB** of memory, **2 s** of uninterrupted synchronous code (loops included), **30 s** per call (**60 s** for `getEpisodes`). Parsing belongs in `html`, not in your own loops: QuickJS is about 50× slower than V8 ([ADR 0010](adr/0010-extension-runtime.md)).

## Build, test, try

```sh
ma-ext build                       # bundle src/index.ts into dist/, check it loads in the sandbox
ma-ext test                        # popular → search → details → episodes → streams, with the app's checks
ma-ext test --source id --pref baseUrl=http://127.0.0.1:8080 -v
ma-ext bench                       # sandbox time per call, and the worst cases
```

`ma-ext test` runs the same runtime and the same result checks as the app, with Node's `fetch` for the network, so it is the fast loop. To try it in the app: **Extensions → Load from folder** (or Settings → Advanced) and pick the folder with `dist/`. The app reloads it when you rebuild.

This repository has a fake site to work against, with listings, embeds (one AES-encrypted), HLS and MP4 media, a Cloudflare-style challenge and streams that expire: `pnpm --filter @matane-anime/test-site serve`, and `extensions/example` is an extension for it that uses the whole contract.

## What the app checks

Everything an extension returns is validated before it is used: titles and lists are bounded, optional fields may be `null`, stream URLs must be http(s), and headers such as `Cookie` and `Host` are dropped. A result that breaks the contract is reported as such, naming the method, instead of showing garbage.
