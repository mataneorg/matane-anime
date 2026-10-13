# Common issues

## A source shows an error or no episodes

1. Open the anime again. If a site shows an anti-bot check, the app opens a window to solve it ([Network](/docs/guides/network#cloudflare-challenges)).
2. In countries or on networks that block sites by DNS, turn on [DNS over HTTPS](/docs/guides/network#dns-over-https).
3. **Update the extension** (Browse, Extensions, Updates). The site probably changed, and that is fixed in the extension. If it still fails, report it to the extension's repository, not Matane Anime's.
4. Check the extension's log: [Diagnosis](/docs/guides/troubleshooting/diagnosis#read-the-extension-log).

If a source cannot be reached, the anime's page shows what the app saved earlier instead of failing.

## A video does not play

Which codecs and containers play depends on your system's Chromium build. The app shows a clear error with actions (**try again**, **change server**). If one server fails, the app already tries the next by itself, up to three times, before letting you choose. Pick another server or quality in the player's server menu. See [Watching and progress](/docs/guides/watching).

## Matane Anime cannot reach anything

Open **Settings, Network, Test connection**. A proxy or DNS-over-HTTPS setting that does not work here is the usual cause: set the proxy to **System settings** and DNS over HTTPS to **Off** to rule them out ([Network](/docs/guides/network)). While offline, the app says so and postpones update checks.

## A site "wants a browser check" or loops on verification

Choose **Solve check** where it appears. The app opens a window with the site's check and, once solved, repeats the request. See [Network](/docs/guides/network#cloudflare-challenges).

## An extension says "needs reinstall"

Its files changed after it was installed, so the app did not load it, or you restored a [backup](/docs/guides/backups#restore) (extension code is not part of one). Open **Browse, Extensions** and **Reinstall** it from its repository (the repositories you had are restored, so they appear under **Available**), or uninstall it.

## An extension is "not installed" on my anime

The anime stays in your library with its progress. Install the extension again, or [migrate the anime to another source](/docs/guides/source-migration).

## Installing an extension fails

- An invalid signature cannot be added, and a repository whose key changed after you trusted it is refused: remove the repository and add it again to trust the new key ([details](/docs/guides/extensions#installing-updating-and-removing)).
- "Needs a newer extension API / version of Matane Anime": update the app ([Updating](/docs/guides/install#updating)).
- "Already installed from another repository" or "a folder you loaded already provides this extension": uninstall the other copy first, or remove the developer folder.

## A download failed or is "broken"

A failed download shows an error with a **retry** button, and what is already downloaded is kept, so a retry fetches only what is missing. If the file of a downloaded episode was deleted from the folder, it is marked **broken** and the app streams it instead. A live stream cannot be downloaded. See [Downloads and offline](/docs/guides/downloads) and the reasons listed on the [Updates page](/docs/guides/updates#the-updates-page).

## New episodes do not show up

- An episode counts as new only if it appeared after you added the anime to the library.
- Check **Settings, Library, New episode checks**: the interval may be off, or the anime may be skipped (completed, never started, or too many unwatched episodes). Checking a single anime always works.
- The app checks while it runs. Turn on **Start with your computer** and **Close to the system tray** to keep it running in the background ([New episodes](/docs/guides/updates#running-in-the-background)).

## The window does not open (Linux)

An AppImage needs FUSE 2 on some distributions; otherwise run it with `--appimage-extract-and-run`. On a distribution that restricts unprivileged user namespaces (Ubuntu 24.04), Chromium's sandbox may stop the window from opening; allow user namespaces, or start the app with `--no-sandbox`, which turns Chromium's sandbox off. See [Install](/docs/guides/install#first-run-warnings).

## Windows or macOS says the app is unsafe

The builds are not code-signed yet. See [first-run warnings](/docs/guides/install#first-run-warnings) for "Run anyway" (Windows) and "Open Anyway" (macOS), and download only from the project's GitHub Releases.

## There is no tray icon (Linux)

The tray needs a desktop that supports AppIndicator. Without it, turn off **Close to the system tray**.

## Still stuck

Follow [Diagnosis](/docs/guides/troubleshooting/diagnosis), then [report the problem](https://github.com/mataneorg/matane-anime/issues).
