# Writing an extension for Matane Anime

An extension is one JavaScript file that tells the app how to read a site: what is popular, what matches a search, what an anime page and its episodes look like, and where the video is. The app does everything else: the network, the player, the library, the downloads, the updates. The contract is in [`packages/extension-sdk/src/types.ts`](../packages/extension-sdk/src/types.ts) and in docs/PRD.md §7.

**Matane Anime ships no extensions, no repositories and no signing keys, and it never suggests any.** What you write, and what you point it at, is up to you; this guide uses only a fake site that lives in this repository.

This page is for authors. Running a repository that others install from is in [repositories.md](repositories.md).

- [What an extension is](#what-an-extension-is)
- [Quick start](#quick-start)
- [The manifest](#the-manifest)
- [The source](#the-source)
- [The sandbox and the host API](#the-sandbox-and-the-host-api)
- [Build, test, bench](#build-test-bench)
- [Trying it in the app: developer mode](#trying-it-in-the-app-developer-mode)
- [Versioning and `migrateUrl`](#versioning-and-migrateurl)
- [Publishing](#publishing)
- [Trying it without a real site](#trying-it-without-a-real-site)
- [Troubleshooting](#troubleshooting)

## What an extension is

A built extension is a folder (`dist/`) with three files, and nothing else:

| File            | What it is                                                                          |
| --------------- | ----------------------------------------------------------------------------------- |
| `manifest.json` | Id, name, version, `apiVersion`, the sources and their languages                    |
| `index.js`      | Your code, bundled into one ES2020 script (`ma-ext build` does this)                |
| `icon.png`      | Shown before installing; **required** to put the extension in a repository (≤ 512 KB) |

It runs inside a QuickJS sandbox, one per extension, with no network or file access of its own: every request goes through the app, which applies rate limits, cookies and the result checks. The same runtime runs in the app and in `ma-ext test`.

## Quick start

### From npm

```sh
npx @matane-anime/extension-cli create my-site --name "My Site" --lang en
cd my-site && npm install     # the scaffold already depends on the SDK and the CLI
npm run build                 # ma-ext build
```

or, in an existing project: `npm i -D @matane-anime/extension-sdk @matane-anime/extension-cli`. Node 22 or newer.

### From a checkout of this repository

Use this to work on the app or the packages, or to try changes that are not released yet.

Requirements: Node 24 and pnpm 12 (see the root README).

```sh
cd matane-anime     # your checkout of this repository
pnpm install        # its `prepare` script builds the SDK and the CLI (packages/extension-cli/dist/cli.js)
```

[`extensions/example`](../extensions/example) is a complete working extension and is part of the pnpm workspace, so `pnpm install` has already linked it (`ma-ext build extensions/example` works as it is). For your own, scaffold a project anywhere on your disk and link the two packages from the checkout:

```sh
node /path/to/matane-anime/packages/extension-cli/bin/ma-ext.js create my-site --name "My Site" --lang en
cd my-site
pnpm add -D link:/path/to/matane-anime/packages/extension-sdk \
            link:/path/to/matane-anime/packages/extension-cli typescript
pnpm build          # runs `ma-ext build`
```

(`ma-ext create` writes `^0.1.0` as the dependency range, which resolves from npm; the `pnpm add` line replaces it with links to your checkout.) Scaffolding _inside_ this repository's workspace writes `workspace:*` instead; that works for folders that the root `pnpm-workspace.yaml` lists.

### What `create` writes

```
my-site/
  manifest.json   id, name, version, apiVersion, type: "anime", sources
  package.json    scripts: build, test, bench, typecheck
  src/index.ts    export default defineExtension({ createSource })  (with TODOs)
  tsconfig.json
```

Add an `icon.png` next to `manifest.json` (a PNG up to 512 KB) when you intend to publish in a repository; `ma-ext build` copies it to `dist/` and warns when it is missing.

## The manifest

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

| Field                  | Rule                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                   | Lower-case letters, digits and `-`, starting with a letter. **No language in it, and it never changes**: libraries, history and downloads refer to it.            |
| `name`                 | Display name.                                                                                                                                                      |
| `version`              | Semantic version, e.g. `1.2.0` (a pre-release part such as `1.0.0-beta.1` is accepted). The app updates only to a _higher_ version. See [Versioning](#versioning-and-migrateurl). |
| `apiVersion`           | The version of the extension contract you built against (`1` today). The app refuses an extension that needs a newer one than it supports. It goes up only for changes that break existing extensions. |
| `type`                 | Must be `"anime"`; anything else is refused, so an extension for another app is not installed by mistake.                                                          |
| `nsfw`                 | `true` for 18+ extensions (default `false`). Hidden unless the user turned on _Show 18+ sources_; see [repositories.md](repositories.md#18-and-language-filters). |
| `rateLimit.perSecond`  | Requests per second (default 10, at most 100). Segments and media have their own, looser limit.                                                                    |
| `userAgent`            | Optional. Sent instead of the app's User-Agent.                                                                                                                    |
| `sources[]`            | At least one. `key` (lower-case letters, digits, `-`; unique inside the extension), `lang` and `name`.                                                              |
| `sources[].lang`       | An ISO 639-1 code, optionally with a region (`id`, `en`, `pt-BR`), or `multi` for a source that mixes languages. `multi` always passes the user's content-language filter. |

A source id is `<id>/<key>`; one extension may offer several (languages, mirrors). The manifest in `dist/` is what the app reads, and it must match what a repository announces.

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
- Everything you return is validated before it is used: titles and lists are bounded, optional fields may be `null`, stream URLs must be http(s), and headers such as `Cookie` and `Host` are dropped. A result that breaks the contract is reported as such, naming the method.

## The sandbox and the host API

There is no `require`, `fetch`, `process`, file access or DOM. These globals exist (types in `@matane-anime/extension-sdk/globals`):

| Global                           | Use                                                                                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http.get/post/request`          | Requests, through the app. Error statuses throw (`404` → `NotFoundError`, `429` → `RateLimitedError`, others `HttpError`); pass `throwOnError: false` to get them back. `Referer` and `Origin` may be set. |
| `html.load(text, { baseUrl })`   | Parses HTML (cheerio, outside the sandbox). `select`, `selectFirst`, `text`, `html`, `attr`, `absUrl`. Nodes live for one call.                                                                           |
| `storage`, `prefs`, `log`        | Per-extension JSON storage, the user's preferences, and a log that shows in the extension log panel (developer mode).                                                                                     |
| `crypto`, `base64`, `utf8`       | md5/sha1/sha256, `aesDecrypt` (cbc, ctr, ecb), encoders. Keep binary values small.                                                                                                                        |
| `URL`, `URLSearchParams`         | Provided; QuickJS has neither. Do not add the DOM lib to your tsconfig.                                                                                                                                   |
| `timers.sleep(ms)`               | Wait.                                                                                                                                                                                                     |

Limits per runtime: **64 MB** of memory, **2 s** of uninterrupted synchronous code (loops included), **30 s** per call (**60 s** for `getEpisodes`). A bundle (`index.js`) is at most **2 MB** and may not call `require()` or `import()`. Parsing belongs in `html`, not in your own loops: QuickJS is about 50× slower than V8 ([ADR 0010](adr/0010-extension-runtime.md)).

## Build, test, bench

```sh
ma-ext create <id> [--name <name>] [--lang <lang>] [--dir <dir>]   # scaffold ./<id>
ma-ext build [dir]                 # bundle src/index.ts into dist/, check it loads in the sandbox
ma-ext test [dir]                  # popular → search → details → episodes → streams, with the app's checks
ma-ext test --source en --query naruto --pref baseUrl=http://127.0.0.1:8080 -v
ma-ext bench [dir]                 # sandbox time per call (p50/p95) and heap
ma-ext bench --synthetic           # only the built-in worst cases, no extension needed
```

- `build` needs a valid `manifest.json` and `src/index.ts`; it fails when the bundle calls `require()`/`import()`, is over 2 MB, or does not load in the sandbox (the network is off during this check).
- `test` runs the same runtime and result checks as the app, with Node's `fetch` for the network, so it is the fast loop. `--source <key>` picks a source (default: the first), `--query <text>` the search (default: the first word of the first popular title), `--pref key=value` sets a preference (repeatable), `-v` prints your `log` output. The exit code is non-zero when a step fails.
- `bench` takes `--source`, `--pref`, `--runs <n>` (default 5) and `--synthetic`.

Inside this repository run the CLI as `node packages/extension-cli/bin/ma-ext.js …` (or `pnpm exec ma-ext` in a package that depends on it).

## Trying it in the app: developer mode

Extensions of a repository are installed by users (see [repositories.md](repositories.md)). While you develop, load the folder instead:

1. **Settings → Advanced → Developer mode** on. This shows _Load from folder_ on the Extensions page and the extension log panel (level filter, clear, copy; load errors appear as log lines). Folders you loaded earlier stay listed with the switch off.
2. Extensions → **Load from folder**, and pick the folder that holds `dist/` (or `manifest.json` + `index.js` directly).
3. Rebuild with `ma-ext build`: the app notices the new files (it checks modification times about once a second) and reloads the extension. A folder that fails to load stays in the list with the reason.

A dev folder always wins over an installed copy with the same id: the installed one is shown as _shadowed_ and runs again when you remove the folder. Two folders cannot provide the same id.

## Versioning and `migrateUrl`

- **Bump `version` in `manifest.json` for every release.** A repository publishes `<id>-<version>.zip`, and users only get an update when the version is higher (semver precedence; `1.0.0` is newer than `1.0.0-beta.1`).
- **`apiVersion`** says which contract the code was written for. Do not raise it by hand; it changes only when the contract breaks old extensions (never so far: it is `1`). An app that does not know the number refuses to install or load the extension, and says so.
- **`migrateUrl(url, kind, fromVersion)`** exists for the day a site changes how its URLs look and a new version of your extension builds them differently. The app asks it to rewrite what it stored:
  - It is called for every stored `url` (`kind` is `"anime"` or `"episode"`) of your extension, with the version that wrote it in `fromVersion`, **once per version change**: right after the extension is installed or updated from a repository, and at the next update check for versions that changed by other means (a dev folder you rebuilt with a bumped version).
  - It covers library anime, anime with watch history, and anime with downloads, and their episodes. Anime that were only seen in a listing are cache and are skipped.
  - The first time the app sees an extension it only records the version; nothing is migrated. That baseline survives an uninstall, so installing an older or newer version later is compared with it.
  - Return the new url, or `null` (or the same string) when nothing changes. It must be **pure**: no `http`, no `storage`. If two stored entries would end up with the same url, the second is left as it was and a warning is logged. If it throws, the version is not recorded and the next check tries again.

```ts
migrateUrl: (url, kind, fromVersion) =>
  url.startsWith('/watch/') ? url.replace('/watch/', '/anime/') : null,
```

## Publishing

To let people install and update your extension, publish a **repository**: a static folder you host anywhere. In short:

```sh
ma-ext build my-site                                   # dist/ must be fresh; repo build never builds
ma-ext repo keygen --out ./keys                        # once; keep repo-key.pem secret
ma-ext repo build my-site --out ./repo --name "My repository" --key ./keys/repo-key.pem
ma-ext repo verify ./repo --key "$(cat ./keys/repo-key.pub)"
```

then upload `./repo` and check the live copy with `ma-ext repo verify https://…/repo/ --key …`. The full story (what is in the folder, trust, serials, rotating a key, what users see) is in [repositories.md](repositories.md). The app ships no repository and does not suggest yours: people add the URL themselves.

## Trying it without a real site

The repository has a fake site with listings, embeds (one AES-encrypted), HLS and MP4 media, a Cloudflare-style challenge and streams that expire, and [`extensions/example`](../extensions/example) is an extension for it that uses the whole contract.

In a checkout, `ma-ext` below means `node packages/extension-cli/bin/ma-ext.js`.

```sh
pnpm --filter @matane-anime/test-site serve          # prints the site address (a free port on 127.0.0.1)
ma-ext build extensions/example
ma-ext test extensions/example --source en --pref baseUrl=http://127.0.0.1:<port>
```

In the app, load `extensions/example` as a dev folder and set its _Site address_ preference to the printed address. To try the _install_ path too, add `--repo` (or `--repo --unsigned`): the server then also serves a repository of `extensions/example` at the `repo:` address it prints (built with the real `ma-ext repo` commands from the CLI that `pnpm install` has built), signed by a throw-away key whose public key and fingerprint it prints. Add that address under Extensions → Add repository. Everything is on loopback; nothing real is contacted.

## Troubleshooting

| You see                                                                                    | It means / what to do                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json is not valid: …` (build)                                                    | The message lists the field. Typical: an `id` with capitals, a `version` that is not semver, `type` other than `"anime"`.                                                                                       |
| `The bundle calls require() or import()`                                                   | Bundle what you need; the sandbox has neither.                                                                                                                                                                  |
| `The bundle does not load in the sandbox`                                                  | Something at the top level of your code needs a global that does not exist (`window`, `fetch`, `process`). Only the host globals above exist.                                                                    |
| `dist/ is stale: it holds x@1.0.0 but manifest.json says 1.1.0` (`repo build`)             | You bumped the version but did not run `ma-ext build`.                                                                                                                                                          |
| `… has no icon: repositories require one`                                                  | Put `icon.png` (≤ 512 KB) next to `manifest.json` and run `ma-ext build` again.                                                                                                                                 |
| The app says the extension needs API _n_                                                   | `apiVersion` in the manifest is higher than the app supports. Update the app, or lower it if you did not need the newer contract.                                                                              |
| More messages (hash mismatch, key changed, serial too low, "The installed files were changed", id conflicts) | These are about repositories: [repositories.md → Troubleshooting](repositories.md#troubleshooting).                                                                                                  |
