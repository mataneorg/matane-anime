# Packages and how they update

Matane Anime is built as several package types. Only the **AppImage** has been built and smoke-tested so far; everything else on this page is configured but **not yet verified** (the owner builds and tries each type on a real machine, see [../releasing.md](../releasing.md)). Releases are beta. Packages are produced by CI (`.github/workflows/release.yml`) when a release is cut; this page does not claim that one exists.

## The package types

| Platform | Package                | Built by                                                  | Updates                       |
| -------- | ---------------------- | --------------------------------------------------------- | ----------------------------- |
| Windows  | NSIS installer (`.exe`) | CI, `electron-builder.yml` (`win`/`nsis`)                | In place (downloads, installs on quit) |
| Windows  | Portable (`.exe`)      | CI (`win`/`portable`, file `...-win-x64-portable.exe`)    | Notifies only                 |
| macOS    | dmg (arm64 and x64)    | CI (`mac`/`dmg`)                                          | Notifies only (unsigned)      |
| Linux    | AppImage               | CI (`linux`/`AppImage`)                                   | In place                      |
| Linux    | deb                    | CI (`linux`/`deb`)                                        | Notifies only; use `apt`/`dpkg` |
| Linux    | rpm                    | CI (`linux`/`rpm`)                                        | Notifies only; use `dnf`/`rpm`  |
| Linux    | Flatpak                | **Draft only**, [manifest](dev.sukun.matane-anime.yml)     | Notifies only; use `flatpak update` |
| Arch     | AUR `matane-anime-bin` | **Draft only**, [PKGBUILD](PKGBUILD)                      | Notifies only; use your AUR helper |

## How auto-update behaves

The app checks GitHub Releases for a newer version (15 seconds after start and every 6 hours, on the stable or the beta channel chosen in Settings). This is the only traffic the app sends besides the sources you use; there is no telemetry. What happens when a newer version is found depends on the package, and is decided by `canInstallUpdates` in `apps/desktop/src/main/app/updater.ts`:

- **NSIS and AppImage** download the update in the background and install it when you quit.
- **macOS** builds are unsigned (PRD R13), so macOS cannot update the app in place: the app shows the new version and a link to the release page.
- **Linux outside an AppImage** (deb, rpm, Flatpak, AUR, or anything else that is not an AppImage) cannot replace itself: the app shows the new version and the link. Update through the package manager.
- **Windows portable** is a single `.exe` that is not installed, so the NSIS update flow does not apply: it only announces the new version. The updater recognises it by the `PORTABLE_EXECUTABLE_FILE` variable that electron-builder's portable launcher sets (a unit test covers the check; the portable build itself has not been run).

Your library, settings and downloads live in the user data folder (`Matane Anime`) and the download folder, not in the package, so switching package type keeps them.
## Things to check after the first CI run

1. The Windows job produces **two** different `.exe` files (the installer `matane-anime-<version>-win-x64.exe` and `...-portable.exe`). Check that `latest.yml` on the release points at the installer, not at the portable file; otherwise NSIS users would be offered the wrong update.
2. The Linux job produces `.AppImage`, `.deb` and `.rpm`. Check that `latest-linux.yml` points at the AppImage.
3. Install the deb and the rpm on a clean machine and start the app (Chromium's sandbox needs unprivileged user namespaces or the setuid `chrome-sandbox`; distributions differ).
4. The deb/rpm `maintainer` in `electron-builder.yml` is a name only, because no contact address has been chosen. The owner may want to add one.

## Flatpak and AUR drafts

Both are marked **UNVERIFIED draft** at the top of each file and need a submission by the owner (Flathub and the AUR). They repackage the deb of a released version, so they cannot be built until a release exists.

- Flatpak: [`dev.sukun.matane-anime.yml`](dev.sukun.matane-anime.yml) and [`dev.sukun.matane-anime.metainfo.xml`](dev.sukun.matane-anime.metainfo.xml). To try it locally, once the placeholders are filled in: `flatpak-builder --user --install --force-clean build-dir dev.sukun.matane-anime.yml` from this folder. Flathub also asks for a matching app id, screenshots and a passing `flatpak-builder-lint`.
- AUR: [`PKGBUILD`](PKGBUILD). To try it: `makepkg -si` in a folder with that file, after filling in the checksum; then `namcap` and `makepkg --printsrcinfo > .SRCINFO` before submitting.
