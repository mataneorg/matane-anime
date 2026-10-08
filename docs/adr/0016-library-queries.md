# 16. Library queries, indexes and purging browse rows

Status: Accepted (2026-10-08)

## Context
The library must open in well under 2 s with 1,000 anime and 50,000 episodes (docs/PRD.md §10.1), filter and sort by several things, search by title, and show per anime: how many episodes are unwatched, the last episode watched, and where "Continue" goes.

## Decision
- **Two queries, aggregation in JavaScript.** `LibraryRepository.list` reads the anime rows of the library (joined with the history) and then all their episodes in one `IN` query with `.raw(true)`, and aggregates per anime with `countEpisodes`, the same function the detail page uses ([`packages/shared/src/episodes.ts`](../../packages/shared/src/episodes.ts)), so a badge and a list can never disagree about how variants count. The phase 2 plan asked for one SQL query; this deviates on purpose, because that rule would otherwise exist twice, once in SQL and once in TypeScript. The measured time below is the check that it is fast enough.
- **Search** uses the FTS5 table `anime_fts` (title and alternative titles, kept in sync by triggers) with a prefix query built by `ftsQuery`, joined with `in_library = 1`.
- **Indexes** (migration `0002_library_indexes`): `anime(in_library, added_at)`, `episodes(anime_id, watched)`, `history(watched_at)`. Tests run `EXPLAIN QUERY PLAN` and fail if the plan stops using them.
- **Virtualised grid** in the renderer (TanStack Virtual), so the DOM holds only the visible cards.
- **Browse rows are cache.** Opening a listing stores a row per anime shown. At startup `purgeBrowseRows` deletes those that are not in the library, were last touched more than **14 days** ago, and have nothing the user did attached: no history, no watched or started episode, no watch session. Episodes and category links follow by cascade, the search index by trigger, and a stored cover file is removed.

## Measured (Linux, seeded 1,000 anime × 50 episodes)
| | result | target |
|---|---|---|
| `library.list` (repository test) | 79 ms median | well under 2 s |
| Cold start to first card (Playwright, `e2e/performance.spec.ts`) | about 1.1 s | under 2 s |
| Reopening the library | about 55 ms | |
| Filtering by text | about 320 ms | |

The e2e limits are looser than the targets on purpose (CI machines are slow); the numbers are attached to the report.

## Consequences
- 14 days is a constant (`BROWSE_ROW_TTL_MS`); a user who browses a lot keeps a bounded table.
- A `dev.seedLibrary` channel exists for these checks. It refuses to run in a packaged app unless `MATANE_SPIKE=1`.
