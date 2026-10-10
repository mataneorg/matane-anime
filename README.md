<div align="center">

<img src="apps/desktop/resources/icon.png" alt="Matane Anime logo" width="96" height="96">

# Matane Anime

**A free anime player for your computer. Keep your list, pick up where you stopped, and watch offline.**

[Download](https://github.com/mataneorg/matane-anime/releases) · [Documentation](https://mataneorg.github.io/matane-anime/) · [Report a problem](https://github.com/mataneorg/matane-anime/issues)

Windows · macOS · Linux

</div>

> **This is a beta.** It works, but it is young. Expect rough edges, and please tell us when you find one.

## What is Matane Anime?

Matane Anime is a free, open-source app that runs on your computer. It gives you one tidy place to find anime, keep a list of what you follow, and watch it in a good video player. It remembers every episode you watch, so you never have to ask yourself "where was I?".

The app comes empty on purpose. It has no anime inside it, and it does not provide any. You choose where your anime come from. [See how that works](#how-do-i-add-anime).

## What you can do

- **Keep a library.** Save the anime you follow and sort them into your own categories. Search, sort and filter them, and pick a grid or a list.
- **Pick up where you stopped.** The app remembers your place in every episode. One click on "Continue watching" takes you back to it.
- **Watch comfortably.** The player has keyboard shortcuts, speed control, fullscreen, and a countdown to the next episode. If a video does not work, you can switch to another quality or server. The app also tries the next one for you.
- **Watch offline.** Download episodes before a trip or a bad-internet day. You can pause and resume them, set a size limit, and the list survives closing the app.
- **Hear about new episodes.** The app checks your library on a schedule you choose and tells you with a notification. New episodes are collected on an Updates page.
- **Search everything at once.** One search looks through all the sources you have added.
- **Switch sources without losing your place.** If an anime moves to another source, you can move it too, and keep your progress.
- **Keep some things private.** Incognito mode stops the app from recording what you watch. There is no tracking in the app.
- **Look at your habits.** A Statistics page shows how much you watched, your streaks and your favourite genres.
- **Make it yours.** Choose a light or dark theme, a pure-black option for OLED screens, and one of 14 accent colors. The app speaks English and Indonesian.
- **Move around fast.** Press `Ctrl+K` (`Cmd+K` on a Mac) to jump to any page, search your library or continue watching.
- **Back up your data.** Save everything to one file by hand, or let the app do it daily or weekly. Restore it later, for example on a new computer.

## Get started in 3 steps

1. **Download** the right file for your computer from the [Releases page](https://github.com/mataneorg/matane-anime/releases). The [table below](#download) tells you which one.
2. **Open it.** Windows and macOS may show a warning the first time, because the app is not yet signed with a paid developer certificate. This is expected. [Here is how to get past it](#a-warning-when-i-open-it).
3. **Add your first extension.** The app starts empty. Go to **Browse**, then **Extensions**, and [add a source](#how-do-i-add-anime).

A short setup on first launch asks for your language, which kinds of content to show, your download folder and a few player choices.

## Download

Get your file from the [Releases page](https://github.com/mataneorg/matane-anime/releases). The version number is part of the file name. Download files only from there.

| Your computer                             | Pick this file                        | What to know                                                                                           |
| ----------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Windows**                               | `matane-anime-…-win-x64.exe`          | The normal choice. It installs the app and updates itself.                                             |
| **Windows**, no install                   | `matane-anime-…-win-x64-portable.exe` | Runs from any folder, such as a USB stick. Nothing is installed. It only tells you about new versions. |
| **Mac** with an Apple chip (M1 and newer) | `matane-anime-…-mac-arm64.dmg`        | Open it and drag the app into Applications. It only tells you about new versions.                      |
| **Mac** with an Intel chip                | `matane-anime-…-mac-x64.dmg`          | Same as above.                                                                                         |
| **Linux**, any distribution               | `matane-anime-…-linux-x64.AppImage`   | One file that runs on most systems. Make it executable and open it. It updates itself.                 |
| **Linux**: Ubuntu, Debian, Mint           | `matane-anime-…-linux-x64.deb`        | Install it with your software installer. It only tells you about new versions.                         |
| **Linux**: Fedora, openSUSE               | `matane-anime-…-linux-x64.rpm`        | Install it with your software installer. It only tells you about new versions.                         |

Not sure about your Mac? Click the Apple menu, then **About This Mac**. If it says "Chip: Apple", pick the Apple-chip file.

"It only tells you about new versions" means the app shows you when a newer one exists, with a link. You then download it yourself, or update through your package manager. Your library and settings are kept.

Some of these file types have been tested more than others. The Linux AppImage is the most tested one. If an installer gives you trouble, please [tell us](https://github.com/mataneorg/matane-anime/issues).

### A warning when I open it

The Windows and macOS apps are not code-signed yet. Your computer does not know us, so it asks you to confirm. The app is not hiding anything: the source code is public.

- **Windows:** if you see "Windows protected your PC", click **More info**, then **Run anyway**.
- **macOS:** right-click the app in Applications, choose **Open**, then click **Open** again. Or go to **System Settings**, then **Privacy & Security**, and click **Open Anyway**.
- **Linux:** no warning, but a few systems need a small extra step for AppImage files.

The [install guide](https://mataneorg.github.io/matane-anime/guide/getting-started) has the full steps, including what to do if macOS says the app is "damaged".

### How do I add anime?

Matane Anime does not come with any anime, and it never suggests where to find them. It works like a video player: it shows what the sources you choose provide.

A **source** is added through an **extension**. Think of an extension as a small plug-in that teaches the app how to read one website. Extensions are published in **repositories**, which are simply web addresses that someone maintains. You get the address from a person or community you trust, outside this app.

1. Open **Browse**, then **Extensions**.
2. Choose **Add repository** and paste the address.
3. The app shows who runs it. Decide whether you trust it.
4. Install the extensions you want. They then appear under **Browse**.

Everything you add is your own choice and your own responsibility. Extensions cannot touch your files or the internet by themselves: the app controls everything they do. A settings option hides 18+ sources, and you can also limit sources by language. The [extensions guide](https://mataneorg.github.io/matane-anime/guide/extensions) has the details.

## Good to know

- **It is a beta.** Things can change, and you may run into bugs. The version you download is shown in **Settings**, then **About**.
- **Your data stays on your computer.** Your library, progress and settings are saved on your computer, and your downloads are in your download folder (`Documents/Matane Anime` by default). Uninstalling does not delete them.
- **There is no tracking.** The app sends no usage data. The only things it connects to are the sources you add, and the project's release page to check for a newer version. You can choose a stable or a beta update channel.
- **Not every video plays everywhere.** Which videos play depends on your system. If one does not work, the app tells you and tries another server.
- **A source stopped working?** Websites change. The fix comes from the extension, not from the app. Update the extension, or tell the people who maintain it.
- **Want a particular site added?** We cannot do that. This project does not provide or suggest any sources.

## Help and feedback

- Read the [documentation](https://mataneorg.github.io/matane-anime/), including a [list of common questions](https://mataneorg.github.io/matane-anime/faq).
- Found a bug or have an idea? [Open an issue](https://github.com/mataneorg/matane-anime/issues).
- Found a security problem? Please do not post it publicly. Follow [SECURITY.md](SECURITY.md).

## License and disclaimer

**Matane Anime does not host, store or distribute any content.** It is a player: it shows what the sources you choose provide. No source, extension repository or signing key comes with the app, and the app does not suggest any. Extensions are written by third parties and added by you, and you are responsible for what you use them for. The developers are **not affiliated with** any site, service or content that a third-party extension provides, and do not control or endorse it.

Matane Anime is free software under the [GPL-3.0-only](LICENSE) license. The tools for people who write extensions are under the MIT license.

<details>
<summary><strong>For developers</strong>: build from source, test, write extensions</summary>

### Build from source

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

### Layout

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

The SDK, runtime and CLI are published on npm as `@matane-anime/extension-sdk`, `@matane-anime/extension-runtime` and `@matane-anime/extension-cli`. The user documentation site lives in [`apps/docs`](apps/docs); see [CONTRIBUTING.md](CONTRIBUTING.md#docs-site) to run it.

### Extensions

Extensions come in two ways:

- **From a repository.** Under **Extensions → Add repository** you paste the address of a repository (a static folder with a signed `index.json`). You see its key's fingerprint and choose whether to trust it, then install, update and uninstall from the same page. Running a repository is described in [docs/repositories.md](docs/repositories.md). Authors build one with `ma-ext repo`.
- **From a folder, in developer mode.** Turn on **Settings → Advanced → Developer mode**, then **Extensions → Load from folder** and pick a folder built with `ma-ext build`. The app reloads it when you rebuild. A dev folder wins over an installed extension with the same id.

To write an extension, read [docs/extensions.md](docs/extensions.md). To try the app without a real site: `pnpm --filter @matane-anime/test-site serve`, build `extensions/example`, load it as a dev folder and set its _Site address_ preference to the address the server prints. Add `--repo` to the `serve` command to also serve a repository of the example, and add that address under Add repository.

Publishing the npm packages (a tag `sdk-v<version>` runs `publish-sdk.yml`) and cutting a beta are described in [docs/releasing.md](docs/releasing.md). Package types and how each one updates are in [docs/packaging](docs/packaging/README.md), which also holds unverified Flatpak and AUR drafts. CI builds the packages with `.github/workflows/release.yml`.

### Playback spike

`/dev/spike` (development only, or `MATANE_SPIKE=1`) plays test streams through the `anime://` proxy and records first-frame time, seek time and codec support. The `Playback spike` GitHub workflow runs it on Linux, Windows and macOS. Results and decisions: [ADR 0008](docs/adr/0008-media-transport.md) and [ADR 0009](docs/adr/0009-codec-support.md). Test media is generated by `pnpm --filter @matane-anime/desktop fixtures` (needs ffmpeg) and is committed.

### Linux notes for developers

An AppImage needs FUSE 2 on some distributions (or run it with `--appimage-extract-and-run`). On a distribution that restricts unprivileged user namespaces (Ubuntu 24.04 does), Chromium's sandbox can stop the window from opening: allow them, or start the app with `--no-sandbox`, knowing that this turns Chromium's sandbox off. On macOS, if the system says the app is damaged, run `xattr -dr com.apple.quarantine "/Applications/Matane Anime.app"`.

### More

- [CONTRIBUTING.md](CONTRIBUTING.md), the [code of conduct](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md).
- [docs/PRD.md](docs/PRD.md) (the plan, in Indonesian) and [docs/adr](docs/adr) (architecture decisions).
- [docs/ui](docs/ui) holds mockups of the screens.

</details>
