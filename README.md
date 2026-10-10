<p align="center"><img src="docs/assets/icon.png" width="128" alt="Matane Anime logo"></p>

<h1 align="center">Matane Anime (またね)</h1>

<p align="center">
  A free, open-source anime player for your desktop.<br>
  Close the app now, pick up on the same episode next time.
</p>

<p align="center">
  <a href="https://github.com/mataneorg/matane-anime/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/mataneorg/matane-anime/total?style=for-the-badge&label=Downloads"></a>
  <a href="https://github.com/mataneorg/matane-anime/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/mataneorg/matane-anime?style=for-the-badge"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/mataneorg/matane-anime?style=for-the-badge"></a>
  <a href="https://saweria.co/PakdeKun"><img alt="Support on Saweria" src="https://img.shields.io/badge/Support-Saweria-F7931E?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="https://github.com/mataneorg/matane-anime/releases">Download</a> ·
  <a href="https://mataneorg.github.io/matane-anime/">Documentation</a> ·
  <a href="https://github.com/mataneorg/matane-anime/issues/new/choose">Report a problem</a> ·
  <a href="#support-the-project">Support</a>
</p>

---

_Matane_ is Japanese for "see you later". Matane Anime runs on **Windows, macOS and Linux**, and it is the anime sibling of the [Matane manga reader](https://github.com/mataneorg/matane). It keeps your list, remembers your place in every episode and lets you watch offline.

> [!NOTE]
> Matane Anime is a **beta** (the latest version is 0.1.0-beta.4). It works, but it is young. If something breaks, please [tell us](https://github.com/mataneorg/matane-anime/issues/new/choose).

> [!IMPORTANT]
> Matane Anime does **not** host or distribute any content, and it comes with **no sources built in**. You choose where your anime comes from by adding an extension repository (a link from someone you trust). See [How do I get anime?](#how-do-i-get-anime)

## Features

**Watch comfortably**

- A full-screen player with keyboard shortcuts you can change, speed control and a countdown to the next episode
- Pick the quality and the server yourself. If one fails, the app tries the next for you
- It remembers your place in every episode, with a "Continue watching" shortcut
- Press <kbd>Ctrl</kbd>+<kbd>K</kbd> (<kbd>Cmd</kbd>+<kbd>K</kbd> on a Mac) to jump to anything

**Keep your library**

- Save the anime you follow and sort them into your own categories
- Search, sort and filter your whole library, as a grid or a list
- Watch history, and an incognito mode that stops the app from recording what you watch
- A Statistics page with your watch time, streaks and favourite genres
- Search across all your sources at once, and move an anime to another source without losing progress

**Watch offline, stay up to date**

- Download episodes with a queue that survives closing the app, and a size limit you set
- The app checks your library for new episodes on a schedule you choose and sends a notification
- New episodes are collected on an Updates page
- It can start with your computer and live in the system tray, so checks and downloads keep going

**Bring your stuff with you**

- Back up your library, progress and settings to one file by hand, or daily or weekly, and restore it any time

**Yours to customise**

- Four [Catppuccin](https://catppuccin.com) themes (one light, three dark), a pure-black option for OLED screens and 14 accent colors
- Available in English and Indonesian
- Optional proxy, DNS-over-HTTPS and custom User-Agent for sites your provider blocks

## Download

Get the latest version from **[GitHub Releases](https://github.com/mataneorg/matane-anime/releases)**. Beta versions are marked "Pre-release".

| Your computer                   | Pick this file                        | What to know                                                     |
| ------------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| **Windows**                     | `matane-anime-…-win-x64.exe`          | The normal choice. It installs the app and updates itself.       |
| **Windows**, no install         | `matane-anime-…-win-x64-portable.exe` | Runs from any folder, such as a USB stick. Nothing is installed. |
| **Mac** with an Apple chip      | `matane-anime-…-mac-arm64.dmg`        | Open it and drag the app into Applications.                      |
| **Mac** with an Intel chip      | `matane-anime-…-mac-x64.dmg`          | Same as above.                                                   |
| **Linux**, any distribution     | `matane-anime-…-linux-x64.AppImage`   | One file that runs on most systems. It updates itself.           |
| **Linux**: Ubuntu, Debian, Mint | `matane-anime-…-linux-x64.deb`        | Install it with your software installer.                         |
| **Linux**: Fedora, openSUSE     | `matane-anime-…-linux-x64.rpm`        | Install it with your software installer.                         |

Not sure about your Mac? Click the Apple menu, then **About This Mac**. If it says "Chip: Apple", pick the Apple-chip file.

Only the Windows installer and the Linux AppImage update themselves. The other files tell you when a new version exists, and you then download it or update with your package manager. Your library and settings are kept. The AppImage is the most tested file type, so if another one gives you trouble, please [tell us](https://github.com/mataneorg/matane-anime/issues/new/choose).

### The first time you open it

Matane Anime is not code-signed yet, so your system will show a warning. This is expected, and the source code is public:

- **Windows:** "Windows protected your PC" → click **More info** → **Run anyway**.
- **macOS:** right-click the app in Applications and choose **Open**, then **Open** again. Or open **System Settings → Privacy & Security** and click **Open Anyway**. If macOS says the app is "damaged", run `xattr -dr com.apple.quarantine "/Applications/Matane Anime.app"` in Terminal.
- **Linux:** make the AppImage executable (`chmod +x matane-anime-*.AppImage`, or right-click → Properties → "Allow executing") and run it. Some distributions need `libfuse2`.

The [install guide](https://mataneorg.github.io/matane-anime/guide/getting-started) has more detail. A short setup on first launch then asks for your language, which kinds of content to show, your download folder and a few player choices.

### Where is my data?

- **App data** (library, progress, settings): `~/.config/Matane Anime` on Linux, `%APPDATA%\Matane Anime` on Windows, `~/Library/Application Support/Matane Anime` on macOS.
- **Downloads:** `Documents/Matane Anime`, unless you pick another folder.
- **Uninstalling** does not delete either of them.
- **Privacy:** there is no telemetry. Nothing is sent anywhere except requests to the sources you use and the update check against GitHub Releases.

## How do I get anime?

Matane Anime gets its anime from **extensions**, small add-ons that each connect to one source. Extensions are published in **repositories**, and a repository is just a web address that someone maintains. The app comes with none and does not suggest any.

1. Get the address of an extension repository from a person or community you trust.
2. In Matane Anime, open **Browse → Extensions** and choose **Add repository**.
3. Check who runs it, then install the sources you want. Now you can browse and watch.

Extensions run in a sandbox, so they cannot reach your files or the internet by themselves. Repositories are signed, so the app can tell if one was tampered with. What you add is your choice and your responsibility. A setting hides 18+ sources, and you can limit sources by language. The full walkthrough is in the [user guide](https://mataneorg.github.io/matane-anime/guide/extensions).

## Support the project

Matane Anime is free and made in spare time. If it makes your evenings nicer and you would like to help keep it going, a donation is very welcome (and never expected).

<p align="center">
  <a href="https://saweria.co/PakdeKun"><img alt="Donate via Saweria" src="https://img.shields.io/badge/Donate%20via-Saweria-F7931E?style=for-the-badge"></a>
</p>

Other ways to help, all free:

- Star the repository
- [Report bugs](https://github.com/mataneorg/matane-anime/issues/new/choose) or [suggest features](https://github.com/mataneorg/matane-anime/issues/new/choose)
- Tell a friend who watches anime

## Help and documentation

- **[User guide and FAQ](https://mataneorg.github.io/matane-anime/)**: installing, library, player, downloads, backup, network settings
- **What's new in each version:** the [Releases page](https://github.com/mataneorg/matane-anime/releases), or **What's new** inside the app (**Settings → About**)
- **[Report a problem](https://github.com/mataneorg/matane-anime/issues/new/choose)**: found a security problem? Please do not post it publicly. Follow [SECURITY.md](SECURITY.md).

## For developers

Want to build Matane Anime from source, fix a bug or write an extension? Everything is in **[DEVELOPMENT.md](DEVELOPMENT.md)**: setup, commands, project layout, extensions, testing and releases. Also see [`CONTRIBUTING.md`](CONTRIBUTING.md) and the [extension guide](https://mataneorg.github.io/matane-anime/authors/).

## License

Matane Anime is released under the [GPL-3.0-only](LICENSE) license. The extension SDK, runtime, CLI and repository format (`packages/extension-*`) are [MIT](packages/extension-sdk/LICENSE).

## Disclaimer

Matane Anime does not host, store or distribute any anime or other content. It is a player: it shows what the sources you choose provide. No source, extension repository or signing key comes with the app, and the app does not suggest any. The developers are not affiliated with any site, service or content that a third-party extension provides, and do not control or endorse it. You are responsible for what you use extensions for. Please respect the creators and the laws of your country.
