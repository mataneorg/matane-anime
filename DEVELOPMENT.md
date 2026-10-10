# Development

Notes for people who want to build Matane Anime from source, fix a bug or write an extension. For the rules on issues, pull requests and commits, read [CONTRIBUTING.md](CONTRIBUTING.md) first. For the user-facing guides, see the [documentation site](https://mataneorg.github.io/matane-anime/) (its source is [`apps/docs`](apps/docs); [CONTRIBUTING.md](CONTRIBUTING.md#docs-site) explains how to run it).

## Build from source

Requirements: Node 24 (see `.node-version`) and pnpm 12. The app is built with Electron, React and TypeScript.

```sh
pnpm install     # also rebuilds better-sqlite3 for Electron
pnpm dev         # starts the app with hot reload
```

| Command                           | What it does                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm format:check` | ESLint and Prettier (`pnpm format` fixes)                                                                                                                                         |
| `pnpm typecheck`                  | TypeScript across all packages                                                                                                                                                    |
| `pnpm test`                       | Unit tests (Vitest, plain Node)                                                                                                                                                   |
| `pnpm build`                      | Production build into `apps/desktop/out`                                                                                                                                          |
| `pnpm e2e`                        | Builds, then runs the Playwright specs against the real app. On headless Linux use `xvfb-run -a pnpm e2e`                                                                         |
| `pnpm dist`                       | Builds the packaged app (an AppImage on Linux) into `apps/desktop/release`; `pnpm smoke:packaged` checks it                                                                       |
| `pnpm verify:packages`            | Packs the SDK, runtime and CLI, installs the tarballs in an empty project and builds and tests an extension there; publishes nothing (needs network for third-party dependencies) |

## Layout

```
apps/desktop            Electron app (main, extension host, preload, renderer)
packages/shared         Domain types, IPC contract, theme constants
packages/extension-sdk  The contract extensions implement (MIT)
packages/extension-runtime  The QuickJS sandbox (MIT)
packages/extension-cli  ma-ext: create, build, test, bench, repo keygen|build|verify (MIT)
packages/extension-repo The extension repository format: keys, signatures, index, archives (MIT; bundled into the CLI and the app, not published on its own)
packages/test-site      A fake anime site on loopback, for tests and for writing extensions
extensions/example      An extension for the fake site; not shipped
extensions/<site>       Extensions for real sites, built from their folder with ma-ext build; not shipped with the app and not
                        part of the pnpm workspace (see docs/extensions.md, "Keeping an extension fast")
apps/docs               The documentation site (VitePress): user guide and extension author guide
docs/                   PRD, extension guide, repositories, releasing, architecture decisions (adr/), UI mockups (ui/)
```

The SDK, runtime and CLI are published on npm as `@matane-anime/extension-sdk`, `@matane-anime/extension-runtime` and `@matane-anime/extension-cli`.

## Extensions

Extensions come in two ways:

- **From a repository.** Under **Extensions → Add repository** you paste the address of a repository (a static folder with a signed `index.json`). You see its key's fingerprint and choose whether to trust it, then install, update and uninstall from the same page. Running a repository is described in [docs/repositories.md](docs/repositories.md). Authors build one with `ma-ext repo`.
- **From a folder, in developer mode.** Turn on **Settings → Advanced → Developer mode**, then **Extensions → Load from folder** and pick a folder built with `ma-ext build`. The app reloads it when you rebuild. A dev folder wins over an installed extension with the same id.

To write an extension, read [docs/extensions.md](docs/extensions.md) (also on the docs site, in the [extension author guide](https://mataneorg.github.io/matane-anime/authors/)). To try the app without a real site: `pnpm --filter @matane-anime/test-site serve`, build `extensions/example`, load it as a dev folder and set its _Site address_ preference to the address the server prints. Add `--repo` to the `serve` command to also serve a repository of the example, and add that address under Add repository.

## Releases and packages

Publishing the npm packages (a tag `sdk-v<version>` runs `publish-sdk.yml`) and cutting a beta are described in [docs/releasing.md](docs/releasing.md). CI builds the packages with `.github/workflows/release.yml`. Package types and how each one updates are in [docs/packaging](docs/packaging/README.md), which also holds unverified Flatpak and AUR drafts.

## Playback spike

`/dev/spike` (development only, or `MATANE_SPIKE=1`) plays test streams through the `anime://` proxy and records first-frame time, seek time and codec support. The `Playback spike` GitHub workflow runs it on Linux, Windows and macOS. Results and decisions: [ADR 0008](docs/adr/0008-media-transport.md) and [ADR 0009](docs/adr/0009-codec-support.md). Test media is generated by `pnpm --filter @matane-anime/desktop fixtures` (needs ffmpeg) and is committed.

## Linux and macOS notes

An AppImage needs FUSE 2 on some distributions (or run it with `--appimage-extract-and-run`). On a distribution that restricts unprivileged user namespaces (Ubuntu 24.04 does), Chromium's sandbox can stop the window from opening: allow them, or start the app with `--no-sandbox`, knowing that this turns Chromium's sandbox off. On macOS, if the system says the app is damaged, run `xattr -dr com.apple.quarantine "/Applications/Matane Anime.app"`.

## More

- [CONTRIBUTING.md](CONTRIBUTING.md), the [code of conduct](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md).
- [docs/PRD.md](docs/PRD.md) (the plan, in Indonesian) and [docs/adr](docs/adr) (architecture decisions).
- [docs/ui](docs/ui) holds mockups of the screens.
