# FAQ and troubleshooting

## Is Matane Anime legal? Where does the content come from?

**Matane Anime does not host, store or distribute any content.** It is a player that shows what the sources you choose provide. No source, extension repository or signing key ships with the app, and the app does not suggest any. Extensions are written and added by third parties and by you, and you are responsible for what you use them for. Whether that is allowed where you live is up to you. The developers are **not affiliated with** any site, service or content that a third-party extension provides, and do not control or endorse it. Support the creators: use official platforms when you can.

## Where are the anime?

There are none built in. You add an extension from a repository whose address you get elsewhere: see [Extensions and repositories](/guide/extensions).

## Can you add support for site X?

No, and the app does not suggest sites. A source is an extension, so the request belongs to the repository of the extension that provides it, or you can [write one](/extensions/).

## A source shows an error or no episodes

1. Open the anime again. If a site shows an anti-bot check, the app opens a window to solve it ([Network](/guide/network#cloudflare-challenges)).
2. In countries that block sites by DNS, turn on [DNS over HTTPS](/guide/network#dns-over-https).
3. Update the extension. The site probably changed, and that is fixed in the extension, not in the app. If it still fails, report it to the extension's repository (not Matane Anime's).

## A video does not play

Which codecs and containers play depends on your system's Chromium build. The app shows a clear error with actions (try again, change server). If one server fails, the app tries the next by itself.

## Matane Anime cannot reach anything

**Settings, Network, Test connection.** A proxy or DNS-over-HTTPS setting that does not work here is the usual cause; set the proxy to **System** and DNS over HTTPS to **Off** to rule them out.

## Windows or macOS says the app is unsafe

The builds are not code-signed yet. See [first-run warnings](/guide/install#first-run-warnings) for "Run anyway" (Windows) and "Open Anyway" (macOS), and download only from the project's GitHub Releases.

## Why does the app not update itself everywhere?

Installed packages and the portable `.exe` cannot replace themselves, and macOS builds are unsigned. The app tells you a new version exists. The AppImage and the Windows installer update in place. See [Updating](/guide/install#updating).

## Downloads: what works?

Downloads handle HLS (video on demand, including AES-128 encrypted segments and separate audio) and MP4. A live stream is refused with a clear message. Segments are written to a temporary folder and renamed into place when everything is complete, so a retry after a failure fetches only what is missing. More in [Downloads and offline](/guide/downloads).

## Where is my data? How do I uninstall completely?

In the app's user data folder (library, progress, settings) and your download folder. Uninstalling does not delete them: delete both folders to remove everything. Use [backup and restore](/guide/backup) to move them or keep a copy first.

## Reporting a bug

Open an issue on [GitHub](https://github.com/mataneorg/matane-anime/issues). Vulnerabilities: report them privately, as described in [SECURITY.md](https://github.com/mataneorg/matane-anime/blob/main/SECURITY.md).

## Does Matane Anime collect data?

No. There is no telemetry. Besides the sources you use and the repositories you added, the only traffic is the check for a new app version on GitHub Releases.

It is free and open source (GPL-3.0).
