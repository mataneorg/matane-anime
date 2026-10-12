# Install

Packages are built by CI when a release is cut and are published on the project's [Releases page](https://github.com/mataneorg/matane-anime/releases). Versions marked "Pre-release" are test builds ahead of the next version. You can also [build from source](https://github.com/mataneorg/matane-anime#build-from-source).

<DownloadButton :guide="false" />

## Pick a package

| Platform | Package                                                | How                                                                            |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Windows  | Installer `matane-anime-<version>-win-x64.exe`         | Run it. Per-user install, you can choose the folder. Updates itself.           |
| Windows  | Portable `matane-anime-<version>-win-x64-portable.exe` | Run it from anywhere; nothing is installed. Only tells you about new versions. |
| macOS    | `.dmg` for Apple silicon (arm64) or Intel (x64)        | Drag the app to Applications. Only tells you about new versions.               |
| Linux    | `.AppImage`                                            | `chmod +x` it and run it. Updates itself.                                      |
| Linux    | `.deb` (Debian, Ubuntu)                                | `sudo apt install ./<file>.deb`. Only tells you about new versions.            |
| Linux    | `.rpm` (Fedora, openSUSE)                              | `sudo dnf install ./<file>.rpm`. Only tells you about new versions.            |
| Linux    | Arch Linux `PKGBUILD`                                  | `makepkg -si`, see below. Only tells you about new versions.                   |

"Only tells you about new versions" means the app shows that an update exists, with a link to the release; you update through the package manager or by downloading the new file. A Flatpak exists only as an unverified draft: see [Packages and updates](https://github.com/mataneorg/matane-anime/blob/main/docs/packaging/README.md).

### Arch Linux

The AppImage works on Arch as it is. To install with pacman instead, build the package from the [`PKGBUILD`](https://github.com/mataneorg/matane-anime/blob/main/docs/packaging/PKGBUILD) in the repository. It repackages the `.deb` of the release named in the file, and it is not on the AUR yet.

```sh
curl -O https://raw.githubusercontent.com/mataneorg/matane-anime/main/docs/packaging/PKGBUILD
updpkgsums && makepkg -si
```

To update, download the newer `PKGBUILD` and build it again.

## First-run warnings

::: warning Unsigned builds
The Windows and macOS builds are not code-signed yet, so your system warns you on first run. Download only from the project's [Releases page](https://github.com/mataneorg/matane-anime/releases).
:::

**Windows (SmartScreen).** If you see "Windows protected your PC", choose **More info**, then **Run anyway**.

**macOS (Gatekeeper).** Right-click (or Control-click) the app in Applications, choose **Open**, then **Open** again. Or open **System Settings, Privacy & Security** and choose **Open Anyway** next to the message about Matane Anime. If macOS says the app is damaged, run `xattr -dr com.apple.quarantine "/Applications/Matane Anime.app"` in a terminal.

**Linux.** An AppImage needs FUSE 2 on some distributions; otherwise run it with `--appimage-extract-and-run`. On a distribution that restricts unprivileged user namespaces (Ubuntu 24.04), Chromium's sandbox may stop the window from opening; allow user namespaces, or start the app with `--no-sandbox`, which turns Chromium's sandbox off.

## First launch

The app starts empty on purpose: it has **no sources**. To watch something you add an extension, which needs a repository address from someone who publishes one. [Extensions and repositories](/guide/extensions) explains the steps. A short onboarding asks for the interface language and theme, the content language, the download folder and shows the player controls. After an update, a **What's new** dialog lists what changed since the version you last used.

Your data (library, progress, settings) lives in the app's user data folder, and downloads in the download folder, which defaults to `Documents/Matane Anime`. Neither is deleted when you uninstall.

## About

**Settings, About** shows the version and the Electron, Chromium and Node versions it runs on, links to the release notes, the source code and the issue tracker, and the licence. **What's new** opens the changes dialog again, and **Run setup again** repeats the first-launch questions.

## Updating

A packaged app checks GitHub Releases 15 seconds after start and every 6 hours, on the **stable** or **beta** channel (a setting). This is the only traffic the app sends besides your sources.

- **Windows installer and Linux AppImage:** downloads in the background and installs when you quit.
- **macOS, Windows portable, Linux deb, rpm, the Arch `PKGBUILD` and Flatpak:** only tells you a new version exists, with a link to the release. macOS builds are unsigned, so macOS cannot update in place; the others are updated by you or your package manager.

See [Packages and updates](https://github.com/mataneorg/matane-anime/blob/main/docs/packaging/README.md) for the details.
