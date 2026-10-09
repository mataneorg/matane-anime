# Updates

There are two kinds of updates: new episodes of anime in your library, and new versions of the app.

## New episodes

The app checks the anime in your library for new episodes on a schedule you choose (off, every 6, 12 (default), 24 or 48 hours, or weekly). It also checks when the app opens if the interval has passed, and you can check by hand for everything, a category or one anime. Three anime are checked at a time; errors are recorded per anime.

- An episode counts as **new** only if the app found it after you added the anime to the library. Episodes that were already listed when you added it never show up as new.
- Skip rules for library and category checks: completed anime (on by default), anime you never watched, and anime with more than N unwatched episodes.
- If a source drops an episode you watched, started, downloaded or have in history, the app keeps it; an empty list from a source never deletes anything.
- New episodes appear on the **Updates** page, grouped by date, with actions to watch, download and mark watched, and a badge in the sidebar. A desktop notification groups them (for example "5 new episodes from 3 anime"); clicking it opens the Updates page.
- Optionally the app can run at login and close to the system tray so checks and downloads continue (on Linux the tray depends on your desktop).

## New versions of the app

A packaged app checks GitHub Releases 15 seconds after start and every 6 hours, on the **stable** or **beta** channel (a setting). This is the only traffic the app sends besides your sources.

What it does with an update depends on the package:

- **Windows installer and Linux AppImage:** downloads in the background and installs when you quit.
- **macOS, Windows portable, Linux deb, rpm, Flatpak and AUR:** only tells you a new version exists, with a link to the release. macOS builds are unsigned, so macOS cannot update in place; the others are updated by you or your package manager.

See [Packages and updates](https://github.com/mataneorg/matane-anime/blob/main/docs/packaging/README.md) for the details.
