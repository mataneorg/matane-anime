# 29. Incognito lives in memory and is only a flag for `WatchService`

Status: Accepted (2026-10-09)

## Context
docs/PRD.md PRG-11: while incognito is on, progress, history and watch sessions are not recorded; explicit actions still apply; an indicator is always visible. [0015](0015-watch-service.md) made `WatchService.progress` the single door for automatic writes and left an `isIncognito` hook.

## Decision
- `IncognitoState` (`main/watch/incognito.ts`) is an in-memory flag with change listeners. It is **off after every start** on purpose: a forgotten switch must not hide watching for good, and it keeps incognito out of settings and backups. The PRD did not say; this is the safer reading.
- `WatchService` gets `isIncognito: () => incognito.enabled`. Its early return in `progress()` is before sessions, progress, history and the started/watched/closed listeners, so download-ahead and delete-after-watched never fire either. Explicit actions (`markWatched`, `markPrevious`, `resetProgress`, history deletion) are not gated.
- IPC: `incognito.get`, `incognito.set` and the `incognito.changed` event; the renderer keeps it in a query that the event updates.
- UI: a pill in the title bar and over the player (the player has no title bar), a banner with "Turn off" on History (mockup 09b), and a "Toggle incognito" action in the command palette.

## Not done
- The player indicator has no mockup; it is a small pill at the top left.
