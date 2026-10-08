# @matane-anime/extension-repo

The extension repository format of Matane Anime, as pure functions (MIT, not published on its own: it is bundled
into the `ma-ext` CLI and the app). Runs in Node and in Electron's main process; the only I/O-free dependencies are
`node:crypto`, `fflate`, `zod` and the SDK manifest schema.

A repository is a static folder:

| File                 | Content                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `index.json`         | `{ format: 1, name, serial, generatedAt, extensions[] }`, parsed by `parseIndex`                 |
| `index.json.sig`     | `{ alg: "ed25519", key: "ed25519:<hex>", sig: "<base64>" }` over the exact bytes of `index.json` |
| `<id>-<version>.zip` | exactly `manifest.json`, `index.js`, `icon.png` (`buildArchive` / `readArchive`)                 |
| `<id>.png`           | the icon shown before installing                                                                 |

- `keys.ts`: `generateKeyPair`, `publicKeyOf`, `parsePublicKey`, `fingerprint`.
- `signature.ts`: `signIndex`, `parseSignatureFile`, `verifyIndexSignature`, `classifyRepo`
  (`unsigned | invalid | unverified | trusted | key-changed`).
- `archive.ts`: deterministic zip writer and a hardened reader (no extra entries, no unsafe paths, no encryption,
  size limits checked before and while inflating, `apiVersion` check).
- `verify.ts`: `verifyPackage` checks downloaded bytes against an index entry.
- `build.ts`: `buildRepoFiles` writes a whole repo in memory; `verifyRepoFiles` re-checks one.
- `versions.ts`: semver `compareVersions`, `isNewer`, `satisfiesMinAppVersion`.

Trust is decided outside this package (by the user's choice of a key in the app, or by `--key` in `ma-ext repo verify`); `classifyRepo` only compares the announced key with the one it is given. The format and the rules the app applies are described in [docs/repositories.md](../../docs/repositories.md).

Every failure is a `RepoError` with a `code`; no raw zod or zip errors escape. Limits (EXT-5) are exported as
`MAX_INDEX_BYTES`, `MAX_ARCHIVE_BYTES`, `MAX_ICON_BYTES` and `MAX_BUNDLE_BYTES`.
