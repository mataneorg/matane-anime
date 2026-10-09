# 31. Extra packages: Windows portable, Linux deb and rpm; Flatpak and AUR stay drafts

Status: Accepted (2026-10-09). None of the new targets has been built yet (the owner builds at home and on the first CI run).

## Context
docs/PRD.md §12 lists portable, deb, rpm, AUR and Flatpak after the beta targets of [0020](0020-beta-packaging.md).

## Decision
- **Built by CI**: `portable` next to `nsis` (artifact name `matane-anime-<version>-win-<arch>-portable.exe`, so it does not overwrite the installer), and `deb` and `rpm` next to the AppImage. `release.yml` passes the targets, installs `rpm` on the Linux runner and uploads `*.deb`, `*.rpm` and the portable `.exe`. The maintainer field is a name only: the project has no address to put there and none was invented.
- **No auto-update for them.** `canInstallUpdates` returns false for a portable build (`PORTABLE_EXECUTABLE_FILE` is set), so it only announces new versions, like a deb or rpm and the unsigned macOS build.
- **Flatpak and AUR are drafts** under `docs/packaging/` (manifest, metainfo, `PKGBUILD`), marked unverified: they need Flathub and AUR accounts and review that cannot be done from the repository.

## Risks to check on the first run
- `latest.yml` must still point at the NSIS installer and `latest-linux.yml` at the AppImage (the new `.exe` and deb/rpm must not be picked as the update).
- The `PORTABLE_EXECUTABLE_FILE` name comes from electron-builder's documentation and is unverified.
- The deb file name (`amd64` or `x64`) and the Flatpak app id (`dev.sukun.matane-anime` may not be accepted by Flathub).
