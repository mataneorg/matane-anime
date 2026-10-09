# FAQ and disclaimer

## Disclaimer

**Matane Anime does not host, store or distribute any content.** It is a player that shows what the sources you choose provide. No source, extension repository or signing key ships with the app, and the app does not suggest any. Extensions are written and added by third parties and by you, and you are responsible for what you use them for. The developers are **not affiliated with** any site, service or content that a third-party extension provides, and do not control or endorse it.

## Frequently asked questions

### Where are the anime?

There are none built in. You add an extension from a repository whose address you get elsewhere: see [Extensions and repositories](/guide/extensions).

### Can you add support for site X?

No, and the app does not suggest sites. A source is an extension, so the request belongs to the repository of the extension that provides it, or you can [write one](/authors/).

### Is it free? Is there telemetry?

It is free and open source (GPL-3.0). There is no telemetry. Besides the sources you use, the only traffic is the check for a new app version on GitHub Releases.

### The system says the app is unsafe or from an unknown developer.

The Windows and macOS builds are not code-signed yet. See [first-run warnings](/guide/getting-started#first-run-warnings), and download only from the project's GitHub Releases.

### Why does the app not update itself on macOS, Linux (deb/rpm) or the portable build?

macOS builds are unsigned, and installed packages and the portable `.exe` cannot replace themselves. The app tells you a new version exists. The AppImage and the Windows installer update in place. See [Packages and updates](https://github.com/mataneorg/matane-anime/blob/main/docs/packaging/README.md).

### A video does not play.

Which codecs and containers play depends on your system's Chromium build. The app shows a clear error with actions (try again, change server). If one server fails, the app tries the next by itself.

### A source shows nothing or fails.

The site probably changed. That is fixed in the extension: update it, or tell its authors.

### Where is my data?

In the app's user data folder (library, progress, settings) and your download folder. Uninstalling does not delete them. Use [backup and restore](/guide/backup) to move them.

### How do I report a bug or a vulnerability?

Bugs: an issue on [GitHub](https://github.com/mataneorg/matane-anime/issues). Vulnerabilities: privately, as described in [SECURITY.md](https://github.com/mataneorg/matane-anime/blob/main/SECURITY.md).
