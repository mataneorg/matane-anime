# 34. Probing streams a few at a time

Status: Accepted (2026-10-09). Covered by unit tests with a fake upstream; not yet seen with real servers.

## Context
Before the player is pointed at a stream, main probes it (docs/PRD.md STR-2): a playlist must be one, a file must answer a one-byte range, with an 8 second timeout. Candidates were probed one after the other, so when the best-ranked servers were dead or slow the user waited for each timeout in turn: two dead servers at the top meant about 16 seconds before the video could start. A stream that fails while playing already falls back to the next one ([STR-3](../PRD.md)); this is about the start.

## Decision
- **A short head start, then a small pool.** `openFirstWorking` starts the best-ranked candidate alone. When it has not answered after 1.5 s (`PROBE_STAGGER_MS`), or when it fails, the next candidate is probed beside it, and so on, with at most 3 probes in flight (`PROBE_PARALLEL`). A failure frees a slot and starts the next candidate at once.
- **The first success wins.** In a healthy case that is the best-ranked stream, because it answers inside its head start, so the ranking (manual choice, quality, last server, extension order; STR-1) still decides what plays. Only when the top choice is slow or dead does a lower-ranked one get ahead of it.
- **Losers are cancelled, not blamed.** `probeStream` takes an `AbortSignal` and reports `cancelled` when it fires. Probes still running when a winner comes in are aborted and their sessions deleted; they are not added to `failed` or to the list of servers tried, so the server picker shows them as available. Only probes that really failed are marked failed and listed.
- **Same error as before.** When nothing answers, the error is `No server answered (<reason of the last failure>)`, and no session is left behind.
- **Switching by hand** probes the single chosen stream through the same code.
- `PlaybackDeps.probeStaggerMs` exists so a test can shorten the head start.

## Consequences
- With two dead servers on top the start takes about 1.5 s plus the working server's answer, not two full timeouts.
- A few more requests go out when the top server is slow: at most 2 extra, and only after the head start. Probes read a few KB (a playlist head or a one-byte range), and go through the same rate-limited upstream as the player.
- A top server slower than 1.5 s but alive can lose to a lower-ranked one that answers first. That is the trade for not waiting; it is the server that actually answered, so playback starts. The next start tries the ranking again, and the server that worked is remembered as the last one (STR-1).
- The head start and the pool size are first guesses; they may be tuned from real use.
