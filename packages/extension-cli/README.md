# @matane-anime/extension-cli

`ma-ext`: create, build, test and benchmark extensions for [Matane Anime](https://github.com/mataneorg/matane-anime).

## Install

> **Not published on npm yet.** The package is prepared for npm (`0.1.0`, checked by `pnpm verify:packages`), but the maintainer has not published it, so the commands below will not work until then. Until it is published, work from a checkout of the [repository](https://github.com/mataneorg/matane-anime): `pnpm install` builds the CLI, which you run as `node packages/extension-cli/bin/ma-ext.js`, and a project outside the checkout links the packages with `pnpm add -D link:/path/to/matane-anime/packages/extension-sdk link:/path/to/matane-anime/packages/extension-cli`. The steps are in [docs/extensions.md](../../docs/extensions.md#quick-start).

Once it is published (Node 22 or newer):

```sh
npm install --save-dev @matane-anime/extension-cli @matane-anime/extension-sdk
```

Or start from a scaffold, which has both set up:

```sh
npx @matane-anime/extension-cli create my-site --name "My Site" --lang en
cd my-site
npm install
```

## Commands

| Command                                           | What it does                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ma-ext create <id>`                              | Scaffolds `./<id>` (`--name`, `--lang`, `--dir`): manifest, `src/index.ts`, tsconfig and package.json                 |
| `ma-ext build [dir]`                              | Bundles `src/index.ts` into `dist/index.js` (+ `manifest.json` and `icon.png`), checking it loads in the sandbox      |
| `ma-ext test [dir]`                               | Runs popular → search → details → episodes → streams against the real site, with the app's checks                     |
| `ma-ext bench [dir]`                              | Times each call in the sandbox (`--source`, `--pref`, `--runs <n>`); `--synthetic` runs the built-in worst cases only |
| `ma-ext repo keygen`, `repo build`, `repo verify` | Creates, signs and checks extension repositories (below)                                                              |

`test` takes `--source <key>`, `--query <text>`, `--pref key=value` (repeatable) and `-v`/`--verbose` for the extension's
log output. Exit code is non-zero when a step fails.

## Repositories

An extension repository is a static folder (host it anywhere): `index.json`, `index.json.sig`, one
`<id>-<version>.zip` per extension and its `<id>.png` icon. The app checks the index signature, then the SHA-256 and
size of everything it downloads.

```sh
ma-ext repo keygen --out ./keys                       # repo-key.pem (private, mode 600) + repo-key.pub
ma-ext build my-site                                  # repo build reads the built dist/, it never builds
ma-ext repo build my-site other-site --out ./repo --name "My repository" --key ./keys/repo-key.pem
ma-ext repo verify ./repo --key "$(cat ./keys/repo-key.pub)"
ma-ext repo verify https://example.com/repo/          # a folder URL or the URL of index.json
```

- `keygen [--out dir]` refuses to overwrite existing keys. Keep `repo-key.pem` secret and never commit it; publish
  the public key (and its fingerprint, which the app shows) so users can compare.
- `build <extensionDir...> --out <dir> --name <name>` needs `--key <pem>` (the private key of `keygen`), or `--unsigned` to publish without a
  signature (users then see "Unverified repository"). Every extension needs `dist/` from `ma-ext build` and an
  `icon.png` (at most 512 KB) next to its `manifest.json`. The new index lists exactly the extensions given, with
  `serial` one higher than the index already in `--out` (or `--serial <n>`; apps refuse a lower one for a repository
  they trust). Files of older versions and unrelated files in `--out` are left alone. `--base-url <url>` writes
  absolute `archive` and `icon` URLs.
- `verify <dirOrUrl> [--key ed25519:…] [--json]` checks the signature, every archive (size, SHA-256, contents,
  manifest against its index entry) and icon. With `--key` it also requires that key to be the signer; without it,
  it only reports the announced key. Exit code 0 when clean, 1 otherwise.

The `dist/` folder can be loaded in the app in developer mode (Settings → Advanced → Developer mode, then Extensions →
Load from folder). The format, trust rules and what users see are in
[docs/repositories.md](../../docs/repositories.md).

## License

MIT
