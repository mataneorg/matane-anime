# 28. Network settings: DoH, proxy and User-Agent are applied to every session, the password stays in main

Status: Accepted (2026-10-09). Not yet exercised inside Electron (`session.setProxy`, `app.configureHostResolver` and `safeStorage` are only checked by hand at home).

## Context
Users behind an ISP that blocks sites need DNS over HTTPS and a proxy, and some sites need another User-Agent (docs/PRD.md US-12, NET-4, NET-6, NET-8, risk R8). [0012](0012-network-layer.md) left the hooks for phase 5.

## Decision
- **Pure first** (`main/network/config.ts`, no `electron` import): provider table (Cloudflare, Google, Quad9, AdGuard, or a custom `https` URL), validation, and the mapping from settings to Electron's host-resolver options and `ProxyConfig`. `NetworkApplier` (`apply.ts`) is the only part that touches Electron, so the rest is unit tested.
- **Everywhere**: the proxy is set on the default session, on `persist:repos` and on every `persist:ext-*` session, including those created later (`NetworkManager.onSession`). DoH is app-wide (`app.configureHostResolver`), so it applies to the repository fetches and the extensions alike. It runs at start and when `settings.set` changes a network key.
- **DoH `auto`** is Chromium's "automatic" mode: DoH first, then the system resolver. This is the reverse of the first wording in the PRD ("when the system resolver fails"); Chromium has no mode for that, and the docs say what it does.
- **Proxy password**: never in `AppSettings` and never sent to the renderer. `ProxyPasswordStore` keeps it under the raw key `network.proxyPassword`, encrypted with `safeStorage` when the keyring exists and in plain text, marked as such, when it does not; the page warns in that case (`proxyPasswordInfo` returns only `{stored, encrypted}`). Backups drop it ([0030](0030-backup-restore.md)). Proxy login challenges are answered from the store (`app.on('login')`, and `client.on('login')` on the two `net.request` fetchers, because the app event does not reach them).
- **User-Agent**: the global value moves from the raw row `network.userAgent` to the `userAgent` setting (copied once at start, then the old row is cleared). Precedence stays: extension manifest, global, default.
- **Connection test** (`network.testConnection`): `HEAD https://www.gstatic.com/generate_204` with the **unsaved** form values over the saved ones, in a throwaway in-memory session. DoH cannot be per session, so a test switches the resolver to the form's DoH settings for its duration and restores the saved ones; tests run one at a time.
- An incomplete proxy (no valid host or port) falls back to the system proxy and the form says what is missing.

## Not done
- SOCKS5 with a user name and password: Chromium cannot send the login. The form says so.
- The endpoint of the test is fixed; making it configurable waits for a request.
- Cloudflare solver windows keep using the extension's session and UA as before.
