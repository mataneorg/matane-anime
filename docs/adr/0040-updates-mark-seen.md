# 40. Updates: mark entries as seen without watching them

Status: Accepted (2026-10-10). Unit tests pass (repository, service, migration); the e2e case is written and was not run.

## Context
The Updates list is derived (UPD-4): an episode is an entry while its anime is in the library, it was fetched after the anime was added, it is unwatched, the source still lists it and it is under 30 days old. The only way to take an entry off the list and the sidebar badge was to mark the episode watched, which changes the user's progress, history-driven rules (UPD-3) and the anime's unwatched count. Someone who wants to clear the badge without having watched anything had no honest option.

Matane (the reference app) marks entries as seen when the Updates page is opened. That makes the badge disappear on a glance and cannot be undone by the user, and with a virtualized list the user may not have looked at most of the entries.

## Decision
- **A new nullable column `episodes.update_seen_at`** (migration `0007_update_seen`, `ALTER TABLE … ADD`). It holds when the user dismissed the entry; null means it still shows. No backfill: existing rows are null, so nothing disappears on upgrade. Backup and restore copy the whole database, so the column travels with them.
- **The list and the badge share one filter.** `NEW_EPISODE` in `UpdatesRepository` gained `AND e.update_seen_at IS NULL`, so `list` and `count` cannot drift apart. The badge query plan is unchanged (library index, then episodes by anime and watched); the new condition is a residual filter on rows already found.
- **`markSeen(episodeIds)` and `markAllSeen()`** on `UpdatesRepository` and `UpdateService`. They stamp only rows that the list shows right now (they reuse `NEW_EPISODE`), return how many were stamped and emit the `updates` change only when something changed, so the sidebar badge and the list refresh through the existing invalidation. Watched state, `watched_at`, `position_ms` and downloads are not touched.
- **IPC:** `updates.markSeen` (`{ episodeIds }` → number) and `updates.markAllSeen` (void → number).
- **UI:** the Updates page has "Mark as seen" on the selection bar, next to "Mark as watched", and "Mark all as seen" in the header, which asks first like "Mark all as watched" does. Marking is explicit: opening the page marks nothing (unlike Matane).
- **Later episodes are never pre-seen.** A new row starts with null. An entry that was seen stays hidden if the source lists it again (the row keeps its id and column) and if it is marked watched and then unwatched; it is a decision the user made about that entry.

## Consequences
- **Seen is one way.** There is no "show seen entries again" action; the anime page still lists every episode, so nothing is lost. Add one if people ask.
- **Notifications are not retracted.** A notification is built from the episodes a check just added, which are never seen yet; marking entries seen afterwards does not remove a notification already shown.
- **A URL migration keeps seen entries hidden**, because it rewrites urls in place and the episode keeps its id and its column.
- **The e2e case** (`updates-ui.spec.ts`) was written but not run in this change; it needs the Electron run on the product owner's machine.
