# Matane Anime

A desktop app for watching anime from sources you choose, with a library, watch progress, downloads and new-episode alerts. Built with Electron, React and TypeScript; styled with Catppuccin.

> **Status: beta-ready (phase 5 built on the `development` branch; the full end-to-end suite passes in the app, packages are not yet verified on every OS).** You can browse sources, search all of them at once, keep anime in a library with categories, watch in the player with server fallback, resume where you left off, see your history, and move an anime to another source without losing progress. Episodes can be downloaded (HLS and MP4, a persistent queue, a size limit) and watched offline, the app checks the library for new episodes on a schedule and lists them under Updates, and a beta AppImage can be built. Extensions come from **repositories** you add yourself: a repository has a signed index (Ed25519), you decide whether to trust its key, extensions install atomically with their hash checked, update from the same repository and uninstall without touching your library; content-language and 18+ filters are enforced in the app, and developer mode loads an extension straight from a folder. Authors build and publish a repository with `ma-ext repo`. The app ships no repository, extension or key. The SDK, runtime and CLI are published on npm as `@matane-anime/extension-sdk`, `-runtime` and `-cli`. Phase 5 adds network settings (DNS over HTTPS, proxy, User-Agent, a connection test), incognito, a command palette, first-run onboarding, What's new, backup and restore, and portable, deb and rpm packages. After phase 5 the interface was brought in line with the Matane reader app and gained a Statistics page, display modes for the library and browse lists, scheduled backups and an About page. See [docs/PRD.md](docs/PRD.md) (Indonesian) for the plan.

## Disclaimer

**Matane Anime does not host, store or distribute any content.** It is a player: it shows what the sources you choose provide. No source, extension repository or signing key ships with the app, and the app does not suggest any. Extensions are written and added by third parties and by you, and you are responsible for what you use them for. The developers are **not affiliated with** any site, service or content that a third-party extension provides, and do not control or endorse it. Requests for a particular site or source belong in the repository of the extension that would provide it, not in this project.

## Features

- **Library** with several categories per anime, four display modes (comfortable grid, compact grid, covers only, list) with an adjustable cover size, sorting and filters that are remembered, text search and multi-select.
- **Player** with HLS and MP4, server and quality menu with automatic fallback to the next server, remembered volume and speed, keyboard shortcuts, next-episode autoplay and a configurable "watched" threshold.
- **Watch progress and history**: resume where you left off, "Continue watching", and an incognito mode that stops progress and history from being recorded.
- **Statistics**: watch time, episodes, streaks, genres, most watched anime and sources over 7 days, 30 days, 12 months or all time. Incognito sessions are never counted.
- **Downloads** for offline viewing (HLS and MP4): a persistent queue, resume, a size limit and optional automatic download of new episodes.
- **New-episode checks** on a schedule, with desktop notifications and an Updates page.
- **Global search** across every installed source, and **moving an anime to another source** without losing progress.
- **Extensions from repositories you add yourself**: signed indexes (Ed25519), a trust decision per key, hash-checked atomic installs, content-language and 18+ filters, and a developer mode that loads an extension from a folder. Extensions run in a sandbox with no network or file access of their own.
- **Network settings**: DNS over HTTPS, HTTP or SOCKS5 proxy, a custom User-Agent and a connection test.
- **Command palette** (`Ctrl+K`), **backup and restore** of your data (by hand or on a daily or weekly schedule), an **About** page, English and Indonesian, Catppuccin themes (Mocha, Latte, Frappé, Macchiato), an AMOLED variant and 14 accent colors.
- No telemetry. The only traffic besides your sources is the check for a new app version on GitHub Releases.

The full guide is the documentation site in [`apps/docs`](apps/docs) (see [CONTRIBUTING.md](CONTRIBUTING.md#docs-site) to run it).

## Install

Releases are **beta**. Packages are built by CI (`.github/workflows/release.yml`) once a release is cut; they will appear under [Releases](https://github.com/mataneorg/matane-anime/releases). Until then, build from source (below). All builds are **unsigned** for now, so your system will warn you the first time.

| Platform | Package                                                | How                                                                                              |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Windows  | Installer `matane-anime-<version>-win-x64.exe`         | Run it. Per-user install; you can choose the folder. Updates in place.                           |
| Windows  | Portable `matane-anime-<version>-win-x64-portable.exe` | Run it from anywhere, nothing is installed. It only tells you about new versions.                |
| macOS    | `matane-anime-<version>-mac-arm64.dmg` / `-x64.dmg`    | Open the dmg and drag the app to Applications. It only tells you about new versions.             |
| Linux    | `.AppImage`                                            | `chmod +x` the file and run it. Updates in place.                                                |
| Linux    | `.deb` (Debian, Ubuntu)                                | `sudo apt install ./matane-anime-<version>-linux-<arch>.deb`. Only tells you about new versions. |
| Linux    | `.rpm` (Fedora, openSUSE)                              | `sudo dnf install ./matane-anime-<version>-linux-<arch>.rpm`. Only tells you about new versions. |

Flatpak and an Arch (AUR) package exist only as unverified drafts in [`docs/packaging`](docs/packaging), which also explains how each type updates. The exact file names are decided by the release; the table shows the pattern.

### Windows: SmartScreen

The installer and the portable `.exe` are not code-signed, so Windows SmartScreen may say "Windows protected your PC". Choose **More info**, then **Run anyway**.

### macOS: Gatekeeper

The app is not signed or notarized, so macOS refuses to open it the first time. Either right-click (or Control-click) the app in Applications, choose **Open**, then **Open** again; or go to **System Settings, Privacy & Security** and choose **Open Anyway** next to the message about Matane Anime. If macOS says the app is damaged, remove the quarantine flag: `xattr -dr com.apple.quarantine "/Applications/Matane Anime.app"`. Because it is unsigned, the macOS build cannot update itself; download the new dmg when the app tells you there is one.

### Linux

An AppImage needs FUSE 2 on some distributions (or run it with `--appimage-extract-and-run`). If the window does not open because of Chromium's sandbox on a distribution that restricts unprivileged user namespaces (Ubuntu 24.04 does), allow them or start the app with `--no-sandbox`, knowing that this turns Chromium's sandbox off.

## Build from source

Requirements: Node 24 (see `.node-version`) and pnpm 12.

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

## Extensions

Matane Anime ships no sources, repositories or keys and does not suggest any. There are two ways to get an extension in:

- **From a repository.** Under **Extensions → Add repository** you paste the address of a repository someone published (a static folder with a signed `index.json`). You see its key's fingerprint and choose whether to trust it, then install, update and uninstall extensions from the same page. The 18+ filter (_Show 18+ sources_) and the content-language filter are in Settings. Running a repository is described in [docs/repositories.md](docs/repositories.md).
- **From a folder, in developer mode.** Turn on **Settings → Advanced → Developer mode**, then **Extensions → Load from folder** and pick a folder built with `ma-ext build`. The app reloads it when you rebuild. A dev folder wins over an installed extension with the same id.

You write an extension for a site as described in [docs/extensions.md](docs/extensions.md). To try the app without a real site: `pnpm --filter @matane-anime/test-site serve`, build `extensions/example`, load it as a dev folder and set its _Site address_ preference to the address the server prints. Add `--repo` to the `serve` command to also serve a repository of the example, and add that address under Add repository. Publishing the npm packages (a tag `sdk-v<version>` runs `publish-sdk.yml`) and cutting a beta are described in [docs/releasing.md](docs/releasing.md).

## Playback spike

`/dev/spike` (development only, or `MATANE_SPIKE=1`) plays test streams through the `anime://` proxy and records first-frame time, seek time and codec support. The `Playback spike` GitHub workflow runs it on Linux, Windows and macOS. Results and decisions: [ADR 0008](docs/adr/0008-media-transport.md) and [ADR 0009](docs/adr/0009-codec-support.md). Test media is generated by `pnpm --filter @matane-anime/desktop fixtures` (needs ffmpeg) and is committed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), the [code of conduct](CODE_OF_CONDUCT.md) and, for vulnerabilities, [SECURITY.md](SECURITY.md).

## License

The app is GPL-3.0-only. `packages/extension-sdk`, `packages/extension-runtime`, `packages/extension-cli` and `packages/extension-repo` are MIT. See [LICENSE](LICENSE).
