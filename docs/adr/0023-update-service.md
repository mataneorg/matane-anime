# 23. UpdateService: new episodes are derived, checks are scheduled and cancellable

Status: Accepted (2026-10-09)

## Context
The app must find new episodes of the library on a schedule, show them, optionally download them, and tell the user once (docs/PRD.md UPD-1…UPD-8, DL-11).

## Decision
- **New episodes are derived, not stored**: an episode of a library anime with `fetched_at > anime.added_at`, not watched, not `source_missing`, first seen within 30 days. Marking watched through `WatchService` is the only write ([0015](0015-watch-service.md)), so there is no "seen" state to keep in sync; the Updates page and the sidebar badge are queries (`UpdatesRepository`, covered by the existing indexes).
- **Baselines never count as new**: the first fetch of an anime that is already in the library, and the episodes a source migration carries over ([0019](0019-source-migration.md); the target gets its `fetched_at` clamped to the carried-over `added_at`). Removing and re-adding an anime starts again.
- **Schedule** (`schedule.ts`, pure, injected clock): off, 6, 12 (default), 24, 48 hours or weekly; `lastRunAt` is a settings key; it catches up at start when the interval has passed, waits while offline and runs when back, its timer is `unref`ed, and a changed interval is applied at once (`settings.set` calls `reschedule()`). It starts after the extension registry finished loading, because a check before that would fail every anime.
- **Checks** run three anime at a time, can be cancelled, and one failure never stops the others; the error is recorded per anime (`anime.update_error`, with `update_checked_at` separate from `last_update_check_at`, which a manual refresh also moves). The skip rules (completed, never watched, more than N unwatched) apply to library and category checks only, never to a single anime.
- **Missing episodes (UPD-5)**: an episode that left the source is deleted unless it was watched, has a position, has a download or is in the history or a watch session (read only); the kept ones are flagged `source_missing`. **An empty list from a source deletes nothing.**
- **After a check, in order**: `migrateUrl` for an extension whose version changed (the last seen version is kept under `updates.extensionVersions`; a failure is logged and retried at the next check; it runs before the refresh because a stale URL would make the refresh fail), then **auto-download** (`autoDownload` on; a category marked `exclude` always wins; with no category marked `include` everything not excluded is allowed, once one is marked `include` only anime in an included category; one copy per episode number; episodes with a download row are skipped), then one grouped **notification**. Automatic checks always notify; a manual one only when the window is not focused; a click focuses the window and sends `app.navigate` to `/updates`.
- The hooks (`autoDownload`, `notify`, `navigate`, `isWindowFocused`, `isOnline`) are injected, so the service is tested without Electron, including against the fake site and a real QuickJS extension.

## Not done
- A URL migration that collides with an existing row leaves that one row on its old URL and logs a warning.
- Notification texts are duplicated in `updates/messages.ts` (English and Indonesian) because the main process has no i18n.
- `episodes.markWatched` does not emit the `updates` tag, so the renderer also invalidates the Updates query on `episodes:*` tags.

## Consequences
- The list of new episodes is always consistent with the library and the watched state.
- A check emits an `updates` tag per anime; the renderer debounces its invalidation.
