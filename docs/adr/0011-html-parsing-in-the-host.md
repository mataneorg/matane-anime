# 11. HTML is parsed in the extension host; network and storage stay in main

Status: Accepted (2026-10-07)

## Context
The `html` API is synchronous and chatty: every `select`, `text()` and `attr()` is a host call, and a listing of 3,000 cards makes about 9,000 of them. Routing each through the main process would add two IPC hops per call and put cheerio's work on main's event loop. Matane reached the same conclusion.

## Decision
- All sandboxes live in **one `utilityProcess`** (the extension host). It holds the QuickJS runtimes and **cheerio**; `html.load` returns a handle and the DOM stays in the host until the call ends.
- **Network, storage, preferences and logs belong to main.** The host asks main for them over a `MessagePort` (`extensions/rpc.ts`); main answers from the network layer ([0012](0012-network-layer.md)) and the database.
- **Main never trusts what the host returns.** Results are checked against the contract with zod (`packages/extension-runtime/src/results.ts`: sizes bounded, `null` normalized, stream URLs must be http(s), headers the host owns are dropped) before anything is stored or shown. `SourceClient` does this for the app and the CLI alike.
- The host is forked on first use and extensions are loaded into it lazily and **unloaded after five idle minutes**. Main notices the host reporting `not_loaded`, loads the extension again and retries once. If the host dies, calls in flight fail with `host_crashed`, and the next call forks a new one.

## Consequences
- Main does no parsing of untrusted HTML: a hostile page can at worst stall the host, which is restartable.
- Tests: the host is killed while the app runs and the next call succeeds; an extension dropped for idleness is reloaded transparently (`e2e/extensions.spec.ts`).
