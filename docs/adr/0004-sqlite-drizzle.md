# 4. SQLite with Drizzle

Status: Accepted (2026-10-06)

## Context
The library, history and downloads are relational and must survive upgrades.

## Decision
`better-sqlite3` with Drizzle (`casing: 'snake_case'`), one file at `userData/data.db`, WAL and `foreign_keys=ON`.

- The whole schema of PRD §9 exists from phase 0 (including tracker and watch-session tables), so later migrations stay small.
- `anime_fts` is an FTS5 table over title and alternative titles, kept in sync by triggers, written as a custom migration.
- Migrations are generated with `drizzle-kit generate` and applied at startup. Before applying any pending migration to an existing database, main copies it to `userData/backups/db/` and keeps the latest 3.
- `better-sqlite3` is an N-API module, so the same binary loads in Electron and in the plain Node that runs the unit tests; database tests run migrations on an in-memory database.

## Consequences
- Repositories (`db/repositories/`) are the only code that touches Drizzle.
- A failed startup is logged and exits instead of leaving a process without a window.
