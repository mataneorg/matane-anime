# General

## What is Matane Anime?

An open-source desktop anime player for Windows, macOS and Linux with a library, watch progress, downloads for offline viewing and new-episode checks. Read the [Introduction](/docs/) or start with [Getting started](/docs/guides/getting-started).

## Is Matane Anime legal? Where does the content come from?

**Matane Anime does not host, store or distribute any content.** It is a player that shows what the sources you choose provide. No source, extension repository or signing key ships with the app, and the app does not suggest any. Extensions are written and added by third parties and by you, and you are responsible for what you use them for. Whether that is allowed where you live is up to you. The developers are **not affiliated with** any site, service or content that a third-party extension provides, and do not control or endorse it. Support the creators: use official platforms when you can.

## Where are the anime?

There are none built in. You add an extension from a repository whose address you get elsewhere: see [Extensions and repositories](/docs/guides/extensions) and [Getting started](/docs/guides/getting-started#adding-sources).

## Can you add support for site X?

No, and the app does not suggest sites. A source is an extension, so the request belongs to the repository of the extension that provides it, or you can [write one](/extensions/).

## Which systems are supported?

Windows (installer and portable), macOS (Apple silicon and Intel) and Linux (AppImage, `.deb`, `.rpm` and an Arch `PKGBUILD`). See the [Download page](/download). There is no mobile version.

## Is it free?

Yes. It is free and open source under the GPL-3.0 license, with no ads, accounts or paid features.

## Does Matane Anime collect data?

No. There is no telemetry. Besides the sources you use and the repositories you added, the only traffic is the check for a new app version on GitHub Releases.

## Does it have an account or sync between computers?

No. Everything stays on your computer. To move to another computer, use [backup and restore](/docs/guides/backups).

## Why does Windows or macOS say the app is unsafe?

The builds are not code-signed yet. See [first-run warnings](/docs/guides/install#first-run-warnings) for "Run anyway" (Windows) and "Open Anyway" (macOS), and download only from the project's GitHub Releases.

## Why does the app not update itself everywhere?

Installed packages and the portable `.exe` cannot replace themselves, and macOS builds are unsigned. The app tells you a new version exists. The AppImage and the Windows installer update in place. See [Updating](/docs/guides/install#updating).

## What languages does the app support?

English and Bahasa Indonesia (**Settings, General, App language**). The content language is a separate setting that filters which sources are offered.

## Does Matane Anime have trackers (AniList, MyAnimeList)?

Not at this time. Your progress, history and [statistics](/docs/guides/statistics) are kept on your computer.

## Reporting a bug

See [Diagnosis](/docs/guides/troubleshooting/diagnosis#reporting-a-bug). Open an issue on [GitHub](https://github.com/mataneorg/matane-anime/issues). Vulnerabilities: report them privately, as described in [SECURITY.md](https://github.com/mataneorg/matane-anime/blob/main/SECURITY.md).

## How can I help?

See [Contribute](/contribute).
