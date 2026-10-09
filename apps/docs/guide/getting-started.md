# Install

Releases are **beta**. Packages are built by CI when a release is cut and are published on the project's [Releases page](https://github.com/mataneorg/matane-anime/releases). Until a release is there, you can [build from source](https://github.com/mataneorg/matane-anime#build-from-source).

## Pick a package

| Platform | Package                                                | How                                                                            |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Windows  | Installer `matane-anime-<version>-win-x64.exe`         | Run it. Per-user install, you can choose the folder. Updates itself.           |
| Windows  | Portable `matane-anime-<version>-win-x64-portable.exe` | Run it from anywhere; nothing is installed. Only tells you about new versions. |
| macOS    | `.dmg` for Apple silicon (arm64) or Intel (x64)        | Drag the app to Applications. Only tells you about new versions.               |
| Linux    | `.AppImage`                                            | `chmod +x` it and run it. Updates itself.                                      |
| Linux    | `.deb` (Debian, Ubuntu)                                | `sudo apt install ./<file>.deb`. Only tells you about new versions.            |
| Linux    | `.rpm` (Fedora, openSUSE)                              | `sudo dnf install ./<file>.rpm`. Only tells you about new versions.            |

"Only tells you about new versions" means the app shows that an update exists, with a link to the release; you update through the package manager or by downloading the new file. Flatpak and an Arch (AUR) package exist only as unverified drafts: see [Packages and updates](https://github.com/mataneorg/matane-anime/blob/main/docs/packaging/README.md).

## First-run warnings

The builds are not code-signed yet, so the first run triggers a warning from your system.

**Windows (SmartScreen).** If you see "Windows protected your PC", choose **More info**, then **Run anyway**.

**macOS (Gatekeeper).** Right-click (or Control-click) the app in Applications, choose **Open**, then **Open** again. Or open **System Settings, Privacy & Security** and choose **Open Anyway** next to the message about Matane Anime. If macOS says the app is damaged, run `xattr -dr com.apple.quarantine "/Applications/Matane Anime.app"` in a terminal.

**Linux.** An AppImage needs FUSE 2 on some distributions; otherwise run it with `--appimage-extract-and-run`. On a distribution that restricts unprivileged user namespaces (Ubuntu 24.04), Chromium's sandbox may stop the window from opening; allow user namespaces, or start the app with `--no-sandbox`, which turns Chromium's sandbox off.

## First launch

The app starts empty on purpose: it has **no sources**. To watch something you add an extension, which needs a repository address from someone who publishes one. [Extensions and repositories](/guide/extensions) explains the steps. A short onboarding asks for the interface language and theme, the content language, the download folder and shows the player controls. After an update, a **What's new** dialog lists what changed since the version you last used.

Your data (library, progress, settings) lives in the app's user data folder, and downloads in the download folder, which defaults to `Documents/Matane Anime`. Neither is deleted when you uninstall.
