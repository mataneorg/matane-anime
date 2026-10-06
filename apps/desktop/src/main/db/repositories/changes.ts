import type { DbChanged } from '@matane-anime/shared';

/**
 * Says what a write touched, as entity tags (`sources`, `extensions`, `anime:<id>`, `episodes:<animeId>`), so
 * the renderer can refresh exactly the queries that depend on them (docs/PRD.md §8.2). Repositories call
 * `emit` after their transaction commits.
 */
export class ChangeEmitter {
  private listeners = new Set<(change: DbChanged) => void>();

  subscribe(listener: (change: DbChanged) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(...tags: string[]): void {
    if (tags.length === 0) return;
    const change = { tags: [...new Set(tags)] };
    for (const listener of this.listeners) listener(change);
  }
}
