# @matane-anime/extension-runtime

The QuickJS sandbox that runs [Matane Anime](https://github.com/mataneorg/matane-anime) extensions. The desktop app
and the `ma-ext` CLI use the same code, so an extension that passes `ma-ext test` behaves the same in the app.

This is a library for embedders (tools that load extension bundles). To write an extension, use
[`@matane-anime/extension-sdk`](../extension-sdk) and [`@matane-anime/extension-cli`](../extension-cli).

## Install

```sh
npm install @matane-anime/extension-runtime
```

Node 22 or newer.

## Usage

```ts
import { readFile } from 'node:fs/promises';
import { ExtensionRuntime, SourceClient } from '@matane-anime/extension-runtime';

const runtime = await ExtensionRuntime.create({
  code: await readFile('dist/index.js', 'utf8'), // the bundle produced by `ma-ext build`
  manifest: JSON.parse(await readFile('dist/manifest.json', 'utf8')),
  hostInfo: { appName: 'my-tool', appVersion: '1.0.0', apiVersion: 1 },
  host: {
    // The embedder decides what the sandbox may reach.
    http: async (request) => {
      /* perform the request and return { status, url, headers, text } */
    },
    storage: { get: async () => null, set: async () => undefined, remove: async () => undefined },
    log: (level, message) => console.log(level, message),
  },
});

const source = SourceClient.forRuntime(runtime, 'en');
console.log(await source.getPopular(1)); // every result is checked against the contract
runtime.dispose();
```

## Entry points

- `@matane-anime/extension-runtime`: `ExtensionRuntime`, `SourceClient`, the limits and error types.
- `@matane-anime/extension-runtime/client`: the part without QuickJS (errors, result validation, `SourceClient`).
  Use it where you only talk to a runtime that lives in another process.

## License

MIT
