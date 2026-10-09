# Security policy

## Supported versions

Matane Anime is in **beta**. Only the latest release (and the latest beta, if it is newer) receives security fixes; there are no long-term support branches yet.

| Version                   | Supported |
| ------------------------- | --------- |
| The latest release / beta | Yes       |
| Older releases            | No        |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** Use GitHub's private vulnerability reporting:

<https://github.com/mataneorg/matane-anime/security/advisories/new>

Include what you found, how to reproduce it, the app version and operating system, and what you think the impact is. A proof of concept helps. You will get a reply in the advisory thread; this is a small, volunteer project, so please allow some time, and please give us a reasonable chance to fix the problem before you disclose it. A dedicated security contact address has not been set up yet.

What is in scope: the app (`apps/desktop`), the extension sandbox and host API, the repository format and its verification, the installer and update path, and the published packages (`@matane-anime/extension-sdk`, `-runtime`, `-cli`). Sandbox escapes, signature or hash bypasses, path traversal in archives, and renderer access to things it should not have are exactly the reports we want.

What is out of scope: the content or behavior of third-party extensions and repositories (report those to their authors), the sites a source reads from, and warnings that come from the app being unsigned (see below).

## How the app protects you

This is a summary; the details are in [docs/extensions.md](docs/extensions.md), [docs/repositories.md](docs/repositories.md) and the decision records [ADR 0010](docs/adr/0010-extension-runtime.md) and [ADR 0024](docs/adr/0024-extension-repositories.md).

- **Extensions are untrusted code.** Each one runs in its own QuickJS (WebAssembly) sandbox with no `require`, `fetch`, `process`, file access or DOM. The only way out is the host API (`http`, `html`, `storage`, `prefs`, `log`, `crypto` and a few helpers), and every request goes through the app, which applies the scheme limits (http and https on every redirect), rate limits, a session of its own per extension, and checks on results. Limits per extension: 64 MB of memory, 2 s of uninterrupted synchronous code, 30 s per call (60 s to list episodes), 32 MB per result. A runaway extension is stopped and reloaded without taking the app down.
- **Repositories are signed, and trust is your choice.** A repository is a static folder with an `index.json` signed with Ed25519 (`index.json.sig`). The app ships with no repository, extension or key and never suggests one. You decide whether to trust a key after seeing its fingerprint; a trusted repository that changes its key or stops signing is refused, an invalid signature is refused for everyone, and a lower `serial` (a rollback) is refused. An unsigned or unverified repository can be added but the app warns you every time you install from it.
- **Installs are checked and atomic.** Before anything is written, the archive's size and SHA-256 are compared with the index; the archive may contain only `manifest.json`, `index.js` and `icon.png`; unsafe paths, encrypted entries and compression bombs are refused. The files are written to a temporary folder and swapped in, and the previous version is restored if anything fails. At every load, the installed `index.js` is checked against the hash recorded at install; a changed file is not run.
- **The renderer has no internet access and no Node.** It runs with a strict content security policy and talks to the main process through a typed IPC contract. The `anime://` protocol serves only sessions created by the main process.
- **No telemetry.** The only traffic besides the sources you choose is the app's check for a new version on GitHub Releases. Secrets such as a proxy password are stored with the operating system's `safeStorage` and are never sent to the renderer.

## What the app does not protect you from

- **Unsigned builds.** The Windows and macOS builds are not code-signed, so SmartScreen and Gatekeeper warn on first run, and the macOS build cannot update itself. Download packages from the project's GitHub Releases only.
- **Trusting a bad key.** If you trust a repository's key, you trust the extensions it publishes: they are sandboxed, but they decide which sites the app talks to and what it shows you.
- **Content from sources.** The app plays what a source returns; it does not judge it.
