# 19. Migrating an anime to another source

Status: Accepted (2026-10-08)

## Context
The same series often exists on several sources, and a source can die. The user should be able to move an entry to another source without losing what was watched (docs/PRD.md BRW-8, P1).

## Decision
- **Match by episode number**, never by title or URL (`planMigration`, pure and tested): the same number in the same variant first, else any variant of that number. Variants that map to one new episode are merged, keeping the state that is further along (watched beats started; a later position beats an earlier one). Episodes without a number match by normalised name. Only episodes with progress take part.
- **Preview before anything changes**: `library.migratePreview` fetches the new anime's episodes and reports how many episodes with progress match and which do not, so the user knows what would be lost.
- **One transaction** (`LibraryRepository.migrate`) moves progress, the history entry (to the matching episode, when newer), categories, library membership, the added date and a custom cover to the new anime. Afterwards the new entry gets its permanent cover and the old one's file is removed ([0017](0017-permanent-covers.md)). The old rows stay as ordinary cache, keep their watch sessions for statistics, and are purged like any browse row later ([0016](0016-library-queries.md)).
- This is the one place besides `WatchService` that writes progress ([0015](0015-watch-service.md)): it moves existing state and does not decide what counts as watched.

## Not done
- Matching by title across sources, and migrating several anime at once: the first is unreliable, the second is a loop over this.
- Downloads belong to the old anime; phase 3 keeps them there ([0021](0021-download-engine.md)).

## Consequences
- Progress that has no counterpart is lost, but the user is told first.
- Migrating to the same anime is refused.
