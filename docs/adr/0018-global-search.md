# 18. Global search is orchestrated in the renderer

Status: Accepted (2026-10-08)

## Context
Global search (docs/PRD.md BRW-2) asks every visible source for a title, five at a time, shows results per source as they arrive, and must be cancellable. The migration dialog ([0019](0019-source-migration.md)) needs the same behaviour.

## Decision
- **No `search.global` channel.** `useGlobalSearch(sources, query)` (`renderer/features/search/`) runs a small pool (`runPool`, five workers) over the existing `sources.browse` channel with `kind: 'search'`. Each call carries a `requestId`; aborting (a new query, leaving the page) sends `requests.cancel`, which stops the request in main as well.
- **Results are keyed.** The store remembers which query and source set its results belong to, so an answer to an older query is never shown, even if it arrives late.
- **Per-source states**: searching, N results, none, error, and "verification needed" for a Cloudflare challenge. Retrying one source asks only that source.
- **The query lives in the URL** (`?q=`), so going back from a result restores the same search, and "View all" opens the source's own browse page already searched.
- **Scope** is the available sources, NSFW only when allowed in the settings, optionally one language. Offline shows a message instead of a wall of errors.

## Consequences
- Simpler than a main-side job with progress events, and cancellation was already there. The cost is that a search stops when the page closes, which is what is wanted.
- The same hook powers the migration dialog.
