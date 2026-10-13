---
title: Download
---

# Download

<DownloadButton :guide="false" />

Packages are built by CI when a release is cut and are published on the project's [Releases page](https://github.com/mataneorg/matane-anime/releases). Versions marked "Pre-release" are test builds ahead of the next version: choose the **Beta** [update channel](/docs/guides/install#updating) to get them. You can also [build from source](https://github.com/mataneorg/matane-anime#build-from-source).

::: warning Unsigned builds
The Windows and macOS builds are not code-signed yet, so your system warns you on first run: see [how to get past it](/docs/guides/install#first-run-warnings). Download only from the project's Releases page.
:::

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

## After installing

Follow [Getting started](/docs/guides/getting-started). Your data lives in the app's user data folder and your downloads in the download folder; neither is deleted when you uninstall.
