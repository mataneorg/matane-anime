# 15. WatchService: one door for progress, history and watch sessions

Status: Accepted (2026-10-08)

## Context
Progress is written from many places: the player's heartbeat, "mark as watched" in lists and the library, "mark all previous", reset. If each wrote the database itself, the rules (when an episode counts as watched, what a variant is, when something enters the history) would drift apart (docs/PRD.md §6.5, PRG-9).

## Decision
`WatchService` (`apps/desktop/src/main/watch/`) is the only code the renderer can reach to change progress, history or watch sessions. The pure rules live in `rules.ts` and `continue.ts` and are unit tested without a database.

1. **Threshold** (PRG-2): an episode becomes watched when the position reaches `playerWatchedThreshold` of its duration (default 85, 50 to 100). 100 means only when the video ends.
2. **Resume** (PRG-4): the saved position minus 3 s, but only if it is past 10 s and short of the threshold; otherwise the episode starts from the beginning. No "resume or restart?" dialog.
3. **Numbers, not rows**: episodes count per **episode number**. Sub and Dub of episode 4 are one episode; marking one marks every variant, and a variant that appears later inherits "watched" from `EpisodesRepository.sync`. Episodes without a number stand alone.
4. **History** (PRG-8) is written only after at least 5 s of real playing, so an accidental click does not fill it. One row per anime (the last episode), moved on every new watch.
5. **Watch sessions** accumulate active time, not wall-clock time: `play` and `heartbeat` mark playing, `pause`, `ended` and `close` stop it, and one step is capped at 15 s so a crashed player cannot invent hours. Sessions left open by a crash are closed at the next start. They are kept for the statistics of a later phase and are never shown or cleared with the history.
6. **Heartbeat**: the player reports every 5 s, so a forced close loses at most 5 s.
7. **Continue target** (`continueTarget`): resume the unfinished episode in the variant being watched; else the next one in that variant; else the first. With no history it anchors on the latest watched episode, so a library that was marked by hand still continues in the right place.
8. **Incognito hook**: every write passes `incognito()`; when it is on, nothing is saved. The UI to switch it on is phase 5.

## Exceptions
Two other writers exist on purpose, and neither decides *whether* something was watched: `EpisodesRepository.sync` gives a new variant of an already-watched number the watched flag, and `LibraryRepository.migrate` moves already existing state to the same series on another source in one transaction ([0019](0019-source-migration.md)).

## Consequences
- The renderer cannot write progress except through the channels `watch.progress`, `episodes.markWatched`, `episodes.markPrevious`, `episodes.resetProgress` and `library.markWatched`, which all end in this class.
- Changing a rule (the threshold, what counts as a variant) is one edit with a test.
