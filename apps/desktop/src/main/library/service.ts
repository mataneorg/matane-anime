import type { LibraryItem, LibraryQuery } from '@matane-anime/shared';
import type { HistoryRepository } from '../db/repositories/history';
import type { LibraryRepository } from '../db/repositories/library';
import type { SettingsRepository } from '../db/repositories/settings';
import type { LibraryCovers } from './covers';

export interface LibraryDeps {
  library: LibraryRepository;
  history: HistoryRepository;
  settings: SettingsRepository;
  covers: LibraryCovers;
}

/** Library membership with its side effects: the permanent cover follows the anime in and out. */
export class LibraryService {
  private readonly deps: LibraryDeps;

  constructor(deps: LibraryDeps) {
    this.deps = deps;
  }

  list(query: LibraryQuery): LibraryItem[] {
    return this.deps.library.list(query, this.deps.settings.getAppSettings().playerWatchedThreshold);
  }

  count(): number {
    return this.deps.library.count();
  }

  add(animeId: number, categoryIds: number[]): void {
    this.deps.library.add(animeId, categoryIds);
    void this.deps.covers.ensure(animeId);
  }

  remove(animeId: number): void {
    this.deps.library.remove(animeId);
    // The cover is kept while the anime is still in the history: the list shows it there.
    if (!this.deps.history.get(animeId)) void this.deps.covers.remove(animeId);
  }
}
