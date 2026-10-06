# 10. Extensions run in QuickJS, one WASM module each

Status: Accepted (2026-10-07)

## Context
Extensions are untrusted code from the community (docs/PRD.md EXT-1, risk R10). A `utilityProcess` alone is a full Node process: it isolates crashes, not capabilities. The pattern is the one Matane proved for manga; this ADR records what holds for Matane Anime and what the benchmark and the tests found.

## Decision
Every extension runs in its own QuickJS (WASM, `quickjs-emscripten` 0.32) runtime, created by `ExtensionRuntime` in `packages/extension-runtime` (MIT, like the SDK and the `ma-ext` CLI). The app and the CLI use the same runtime through a small `HostApi` (`http`, `storage`, `log`), so an extension that passes `ma-ext test` behaves the same in the app.

What the sandbox sees: `http`, `html`, `storage`, `prefs`, `log`, `crypto` (md5/sha1/sha256/`aesDecrypt`), `base64`, `utf8`, `timers.sleep`, and `URL` / `URLSearchParams` (QuickJS has no web APIs, and nearly every extension needs them; found by running the first real extension). No `require`, `fetch`, `process`, files or `import()`; `eval` is allowed because packed embeds need it. The globals are frozen.

Limits (docs/PRD.md EXT-2), unchanged by the benchmark: **64 MB** heap, **2 s** of uninterrupted synchronous code, **30 s** per call (**60 s** for `getEpisodes`).

### The memory limit needed a second layer
`setMemoryLimit` alone is not a limit in this build: a loop of `new Array(10000).fill('x')` reached **150 MB under a 4 MB limit**, while a loop of `push` of objects stopped at once. So each runtime gets its **own WASM module whose `WebAssembly.Memory` cannot grow past a hard cap** (`max(2 × limit, 48 MB)`, 128 MB by default). Beyond it an allocation fails inside the sandbox as an ordinary "out of memory". Creating a module costs ~10 ms. After an out-of-memory or an interrupt the runtime is disposed and the app loads the extension again (disposing a runtime that hit the cap aborts inside QuickJS; that is caught and the module is dropped).

Other things the tests pin down: an interrupt is not catchable by the extension; a promise job that grows WASM memory can hand back a stray context, which is disposed so `dispose()` does not abort (a bug carried over from Matane's notes); results above 32 MB are refused.

## Benchmark
`ma-ext bench --runs 9` (Linux, Node 24; the example extension against the fake site, plus synthetic worst cases):

| Case | Sandbox time p50 / p95 | Accounted memory needed |
|---|---|---|
| Example extension: popular, details, episodes, streams | ≤ 7 / 29 ms (wall time is the network) | < 1 MB |
| Creating a runtime (own WASM module) | 8 / 23 ms | 0.1 MB |
| 10k-episode JSON feed mapped | 88 / 105 ms | about 2 MB |
| 3k-card HTML page, 9k `html` bridge calls | 558 / 768 ms | about 1 MB |
| 5M-iteration CPU loop | 317 / 347 ms | about 1 MB |

"Memory needed" is the smallest `setMemoryLimit` at which the case still passes (bisected). The worst realistic case needs about 3% of the heap and 40% of the synchronous budget, so the limits stay. QuickJS is roughly 50× slower than V8 on tight loops, which is why HTML parsing stays out of it ([0011](0011-html-parsing-in-the-host.md)).

## Consequences
- Extension authors write sandbox-safe JavaScript only, and must not add the DOM lib to their tsconfig (the SDK declares `URL` itself).
- A runaway extension costs at most its own module: the extension host process survives, and is restarted if it does not.
