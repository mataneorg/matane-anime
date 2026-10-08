# Extension repositories

A repository is a static folder on any web host that lists extensions and carries their downloads. Users add its address in the app, decide whether to trust its signing key, and then install, update and remove extensions from it. This page is for people who **publish** one, and explains what users see and what the app checks. How to write an extension is in [extensions.md](extensions.md).

**Matane Anime ships no repository, no extension and no key, and never suggests one** (docs/PRD.md EXT-7). An empty install has nothing to install from; people bring their own address. Nothing here names or links a real site.

- [The format](#the-format)
- [Publishing a repository](#publishing-a-repository)
- [Trust, signatures and rollbacks](#trust-signatures-and-rollbacks)
- [What users see](#what-users-see)
- [18+ and language filters](#18-and-language-filters)
- [What the app checks](#what-the-app-checks)
- [Troubleshooting](#troubleshooting)

## The format

`ma-ext repo build` writes this folder; any static host (a web server, object storage, GitHub Pages) can serve it. The app only needs plain `GET` requests; use https.

```
repo/
  index.json            the list of extensions
  index.json.sig        the signature of index.json
  my-site-0.1.0.zip     one archive per extension version: manifest.json, index.js, icon.png (nothing else)
  my-site.png           the icon, shown before installing
```

`index.json`:

```json
{
  "format": 1,
  "name": "My repository",
  "serial": 2,
  "generatedAt": "2026-10-09T10:00:00.000Z",
  "extensions": [
    {
      "id": "my-site",
      "name": "My Site",
      "version": "0.1.0",
      "apiVersion": 1,
      "nsfw": false,
      "langs": ["en"],
      "sources": [{ "key": "en", "lang": "en", "name": "My Site (EN)" }],
      "archive": "my-site-0.1.0.zip",
      "sha256": "…64 hex characters…",
      "size": 4003,
      "icon": "my-site.png",
      "iconSha256": "…",
      "iconSize": 355
    }
  ]
}
```

| Field                         | Meaning                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `format`                      | `1`.                                                                                                                                                   |
| `serial`                      | An integer that goes up with every build. Apps refuse an index with a lower serial than the one they accepted ([rollbacks](#trust-signatures-and-rollbacks)). |
| `generatedAt`                 | ISO 8601 time of the build; informational.                                                                                                             |
| `extensions[]`                | One entry per extension, ids unique. `id`, `name`, `version`, `apiVersion`, `nsfw`, `langs` and `sources` repeat the manifest inside the archive, and the app rejects a package that contradicts them. |
| `archive`, `icon`             | A path relative to `index.json`, or an absolute http(s) URL (`ma-ext repo build --base-url <url>` writes absolute ones). Other schemes are refused.     |
| `sha256`, `size`              | Of the archive file; `iconSha256`, `iconSize` of the icon. The app checks them before writing anything.                                              |
| `minAppVersion` (optional)    | Semver of the oldest app that can run the extension. The app honours it, but `ma-ext repo build` does not write it yet.                                |

`index.json.sig` is JSON: `{ "alg": "ed25519", "key": "ed25519:<64 hex>", "sig": "<base64>" }`. The signature covers the **exact bytes** of `index.json` (no canonical form), so never edit the index after signing; build again. The key is the raw 32-byte Ed25519 public key in lower-case hex.

Limits: `index.json` 2 MB, an archive 20 MB, an icon 512 KB, `index.js` inside the archive 2 MB (`manifest.json` 64 KB). The archive may contain exactly `manifest.json`, `index.js` and `icon.png`: no folders, no other entries, no encryption.

## Publishing a repository

The commands below are real; the `ma-ext` binary is described in [extensions.md](extensions.md#build-test-bench) (in a checkout: `node packages/extension-cli/bin/ma-ext.js`).

1. **Make a key, once.**

   ```sh
   ma-ext repo keygen --out ./keys
   ```

   Writes `repo-key.pem` (private, mode 600) and `repo-key.pub` (`ed25519:<hex>`) and prints the public key and its short fingerprint (`ed25519:8e3e…09b0`). It refuses to overwrite existing keys. **Keep `repo-key.pem` secret and out of git** (add `keys/` to `.gitignore`, back it up somewhere safe): whoever holds it can publish as your repository, and if you lose it you cannot continue the repository, see [rotating a key](#rotating-a-key). Publish the public key and fingerprint where users can read them (your site, your README), so they can compare it with what the app shows.

2. **Build each extension.**

   ```sh
   ma-ext build path/to/my-site
   ```

   `repo build` reads the built `dist/` and never builds; it stops if `dist/` is missing, holds another version than `manifest.json` says, or has no `icon.png`.

3. **Build the repository.**

   ```sh
   ma-ext repo build path/to/my-site path/to/other-site \
     --out ./repo --name "My repository" --key ./keys/repo-key.pem
   ```

   Options: `--out <dir>` and `--name <name>` (required); `--key <pem>` (signing is the default) or `--unsigned`; `--serial <n>` (default: the previous index's serial in `--out` plus 1, else 1); `--base-url <url>`. **The new index lists exactly the extensions you pass in this run.** Pass all of them every time. An extension you leave out disappears from the list (its older zips stay on disk but are no longer offered, and users who have it installed stop seeing updates). Files in `--out` that were not written by this run are left alone, so delete old zips yourself when you want them gone.

4. **Check it.**

   ```sh
   ma-ext repo verify ./repo --key "$(cat ./keys/repo-key.pub)"
   ```

   Checks the signature, then every archive (size, SHA-256, contents, manifest against its index entry) and icon. With `--key` it also requires that key to be the signer; without it, it only reports the announced key. `--json` prints the report as JSON. Exit code 0 means consistent, 1 means problems.

5. **Upload the folder** to your static host: archives and icons first, then `index.json`, and `index.json.sig` last. (If someone fetches between the last two, the signature does not match the index; the app refuses that refresh and tries again later.)

6. **Check the live copy.**

   ```sh
   ma-ext repo verify https://example.org/repo/ --key "$(cat ./keys/repo-key.pub)"
   ```

   Accepts the folder URL or the URL of `index.json`.

7. **Release a new version:** raise `version` in the extension's `manifest.json`, `ma-ext build`, run `repo build` again with the same `--out` (the serial goes up by itself), verify, upload.

Users add `https://example.org/repo/` (the folder, or the URL of `index.json`; the app accepts both).

## Trust, signatures and rollbacks

Trust is the **user's choice of a key**, not something the index claims. The app compares the key a repository announces with the key the user decided to trust.

| State shown               | When                                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trusted key**           | The index is signed, and the signing key is the one the user chose with _Trust this key_ when adding the repository (the app shows the key's fingerprint). |
| **Unverified repository** | The index is signed but the user did not trust the key, or it is not signed at all. It can be added and used, with a warning when adding and when installing. |
| _(refused)_               | The signature does not match the index: the repository is not added, and a refresh is rejected.                                                          |

Why `--unsigned` is discouraged: nothing proves that the index and the archives came from you. Anyone who can change the files (or the network path to them) can serve a different extension, and the user has no way to notice. The SHA-256 values in an unsigned index only protect against corrupt downloads, not against a changed index. A signed repository whose key the user trusted rejects tampered indexes.

Rules the app applies when it re-reads a repository (at start when online, before each scheduled update check, and on request in the Extensions page):

- **Serial / rollback.** An index whose `serial` is lower than the last accepted one is refused and the old one is kept (the repository "went back in time"). An equal serial is accepted. This protects against an old, validly signed index being served again, for example to hide a fix. Never lower `--serial` on purpose; `repo build` warns if you do.
- **A trusted repository must keep its key and keep signing.** An index that is no longer signed, or is signed by another key, is refused; the previous index stays in use and the error is shown on the repository.
- **Updates only go up.** An installed extension is only replaced by a _higher_ version offered by the repository it was installed from.
- **Invalid signatures are never accepted**, trusted or not.

An unverified repository has no trusted key to hold it to, so it may change its key freely; that is what "unverified" means.

### Rotating a key

Users who trusted your old key will refuse indexes signed with the new one (by design: that is exactly what a stolen-key takeover would look like). To move to a new key, publish the new public key and fingerprint out of band, then each user **removes the repository and adds it again**, trusting the new key. Their installed extensions are not uninstalled: they keep working but are no longer linked to a repository (no updates), and installing the same extension again from the re-added repository replaces that copy and links it again. Plan for this; losing the private key means the same procedure.

## What users see

1. **Add repository** (Extensions page): they paste the address. The app downloads `index.json` and `index.json.sig` and shows the name, how many extensions it lists and, if signed, the key's fingerprint with an _Unverified repository_ warning and a _Trust this key_ choice. A repository with a bad signature cannot be added. A repository that was already added is not added twice.
2. **Available** tab: what the repositories offer, with name, version, languages, size and an _Install_ button. Extensions that need a newer API or app are marked incompatible and cannot be installed. 18+ and other-language entries are filtered ([below](#18-and-language-filters)).
3. **Install** is two steps. The app first downloads and checks everything, then shows a dialog: the repository and its trust state (with the key fingerprint), the extension's name, version, API version, languages, size and **SHA-256**, plus warnings (_unverified repository_, 18+). Nothing is written until the user confirms, and the confirmation expires after 5 minutes.
4. **Atomic install.** The files are written to `<id>.tmp` in the app's data folder, the old copy (if any) is moved to `<id>.old`, the new folder is renamed into place and loaded into the sandbox. If anything fails, including the extension not loading, the previous version is put back and nothing changes. A crash in the middle is repaired at the next start.
5. **Update.** When a repository offers a higher version, the installed row shows an update badge, and the page offers _Update all_. Updating installs directly, without the dialog, and only from the repository the extension came from. Checking the repositories never installs anything by itself. After an update, [`migrateUrl`](extensions.md#versioning-and-migrateurl) runs on the user's stored URLs.
6. **Uninstall** (with a confirmation) deletes the extension's files, its preferences, its storage and its browser session (cookies, cache). **The user's library, history and downloads stay**; their anime are shown as "source not installed" until the extension is installed again, and then they work as before.
7. **Developer mode** is separate: a folder loaded in developer mode is not installed, is not updated and is not part of any repository ([extensions.md](extensions.md#trying-it-in-the-app-developer-mode)). If a dev folder and an installed extension have the same `id`, the dev folder runs and the installed copy is marked shadowed until the folder is removed. An `id` installed from one repository cannot be installed from a second one at the same time.

## 18+ and language filters

- **`nsfw: true`** in the manifest marks an extension as 18+. By default 18+ content is hidden: such extensions are not offered in Available, their sources do not appear in Browse or in global search, and the app refuses to browse them. It is enforced in the app's main process, not only drawn in the interface. The user switches it on with _Show 18+ sources_ in Settings. Set it honestly: the index repeats it and the app rejects a package whose manifest says otherwise.
- **`sources[].lang`** is the content language of each source. The user may choose content languages in Settings (_Content language_); with none chosen, everything is shown. An extension is offered when any of its languages is wanted; a source appears in Browse and search when its own language is wanted. `multi` always passes, and a chosen `pt` also matches `pt-BR`.
- The **Installed** tab is never filtered, so every installed extension can be updated or removed whatever the settings are.

## What the app checks

- **Index:** at most 2 MB, valid JSON of `format` 1, no duplicate ids, only http(s) or relative references.
- **Signature:** Ed25519 over the exact index bytes; the announced key against the trusted key; the serial against the last accepted one.
- **Archive, before anything is written:** size and SHA-256 against the index; only `manifest.json`, `index.js`, `icon.png`; no unsafe paths, no encryption; declared sizes within limits and inflating never goes past them (compression bombs); a manifest that passes the manifest schema; `apiVersion` not higher than the app supports; `minAppVersion` (if given) not higher than the app; the manifest's id, version, `apiVersion`, `nsfw`, languages and sources equal to the index entry; the icon's size and SHA-256.
- **Every time an installed extension is loaded** (start, after install or update): the SHA-256 of the installed `index.js` equals the one recorded at install, its manifest has the expected `id`, it fits the size limit and its `apiVersion` is supported. Otherwise it is marked with an error and **not run**: "The installed files were changed; reinstall the extension."
- **At run time:** the sandbox limits and the result checks described in [extensions.md](extensions.md#the-sandbox-and-the-host-api).

The app talks to a repository only to download these files, with plain `GET` requests from its own network client (separate from the extensions': its own session, no cookies, the app's User-Agent). Nothing about the user, their library or what is installed is sent.

## Troubleshooting

Messages are shown by the app unless marked `ma-ext`.

| Message / symptom                                                                                              | Meaning and what to do                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The signature of this repository does not match its index. It may have been tampered with, so it was not added. | `index.json` was changed after signing, or `index.json.sig` belongs to another index. Publishers: run `repo build` again and re-upload both files (sig last). Users: do not trust this copy.        |
| The repository is now signed with a different key than the one you trusted. The new index was refused; remove the repository and add it again to trust the new key. | The publisher rotated or lost a key, or somebody else controls the host. Compare the new fingerprint with what the publisher announced before re-adding.                                  |
| The repository is trusted but its index is no longer signed. The new index was refused.                        | The publisher published with `--unsigned`, or the signature file is gone. The previous index stays in use.                                                                                   |
| The repository went back in time (serial _n_, last accepted _m_). The old index was kept.                       | The index is older than one the app saw. Publishers: you rebuilt from an old copy of `--out`, or used a low `--serial`; build again with a higher serial.                                    |
| The download does not match the SHA-256 in the repository index, so it was not installed.                      | The archive differs from what the index promises: a stale or partly uploaded file, a CDN cache serving an older zip, or tampering. Publishers: re-upload, then `ma-ext repo verify <url>`.        |
| The download does not have the size the index promises / The package contradicts the repository index / The package is not a valid extension archive | Same family: `ma-ext repo verify` on the live URL names the entry and the problem.                                                                                    |
| _name_ needs extension API _n_; this app supports up to _m_. Update the app to install it.                     | The extension's `apiVersion` is newer than the app knows (or `minAppVersion` is higher than the app). Update the app.                                                                       |
| The installed files were changed; reinstall the extension.                                                     | `index.js` in the app's data folder no longer has the recorded hash (edited, damaged, antivirus). Uninstall and install again.                                                                |
| _id_ is loaded from a dev folder. Remove the folder before installing it from a repository.                    | One `id` comes from one place. Remove the developer-mode folder first.                                                                                                                       |
| _id_ is already installed from _repository_. An extension id can come from one repository at a time; uninstall it first. | Two repositories offer the same id; keep one.                                                                                                                                     |
| This install request expired. Start the install again.                                                         | The confirmation is valid for 5 minutes.                                                                                                                                                     |
| _name_ could not be loaded, so nothing was changed.                                                            | The package passed every check but does not load in the sandbox. The previous version, if any, is still installed. Publishers: `ma-ext build` and `ma-ext test` before releasing.           |
| The server answered _n_ / was not found (404) / You are offline                                                | The URL, the host or the connection; the repository keeps its last good index and shows the error.                                                                                           |
| `ma-ext`: _x_ has no icon: repositories require one                                                            | Add `icon.png` next to the manifest and `ma-ext build` again.                                                                                                                                |
| `ma-ext`: _x_/dist is stale: it holds …                                                                        | `version` in `manifest.json` differs from `dist/`; run `ma-ext build` again.                                                                                                                 |
| `ma-ext`: `… index.json … is not a valid index, so the next serial is unknown`                                 | `--out` holds a damaged `index.json`; fix or remove it, or pass `--serial`.                                                                                                                  |
