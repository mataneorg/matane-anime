# @matane-anime/extension-sdk

Types and helpers for writing [Matane Anime](https://github.com/SukunDev/matane-anime) extensions: the contract an
extension implements (`defineExtension`, `AnimeSummary`, `Episode`, `Stream`, the error classes), the types of the
host globals available inside the sandbox (`http`, `html`, `storage`, `prefs`, `log`, …) and the manifest schema.

Most people want [`@matane-anime/extension-cli`](../extension-cli), which scaffolds a project that already depends on
this package. The full author's guide is [docs/extensions.md](../../docs/extensions.md).

## Install

> **Not published on npm yet.** The package is prepared for npm (`0.1.0`, checked by `pnpm verify:packages`), but the maintainer has not published it, so `npm install` will not find it until then. Until it is published, use the workspace of the [repository](https://github.com/SukunDev/matane-anime): see the quick start in [docs/extensions.md](https://github.com/SukunDev/matane-anime/blob/main/docs/extensions.md#quick-start).

Once it is published:

```sh
npm install --save-dev @matane-anime/extension-sdk
```

## Usage

```ts
import '@matane-anime/extension-sdk/globals'; // types for http, html, storage, prefs, log, …
import { NotFoundError, defineExtension } from '@matane-anime/extension-sdk';

export default defineExtension({
  createSource: ({ lang }) => ({
    baseUrl: 'https://example.com',
    async getPopular(page) {
      const url = `https://example.com/popular?page=${page}`;
      const doc = html.load((await http.get(url)).text, { baseUrl: url });
      const items = doc.select('.card').map((card) => ({
        url: card.selectFirst('a')?.attr('href') ?? '',
        title: card.selectFirst('.title')?.text().trim() ?? '',
      }));
      return { items, hasNextPage: doc.selectFirst('a.next') !== null };
    },
    // search, getAnimeDetails, getEpisodes, getStreams …
    async getStreams() {
      throw new NotFoundError('not implemented');
    },
  }),
});
```

An extension runs in a QuickJS sandbox: there is no `fetch`, `require` or `process`. Bundle and check it with
`ma-ext build`.

## Entry points

| Import                                 | Contents                                                            |
| -------------------------------------- | ------------------------------------------------------------------- |
| `@matane-anime/extension-sdk`          | `defineExtension`, contract types, error classes                    |
| `@matane-anime/extension-sdk/manifest` | `manifestSchema` (zod), `ExtensionManifest`, `API_VERSION`          |
| `@matane-anime/extension-sdk/globals`  | global declarations for the sandbox (import it for the side effect) |

## License

MIT
