/**
 * Whether incognito is on (docs/PRD.md PRG-11). Kept in memory on purpose: it is off again after a restart, so a
 * forgotten switch never hides what the user watches for good. `WatchService` asks `enabled` before it records.
 */
export class IncognitoState {
  private on = false;
  private readonly listeners = new Set<(on: boolean) => void>();

  get enabled(): boolean {
    return this.on;
  }

  /** Returns the state afterwards. Listeners only hear about a real change. */
  set(on: boolean): boolean {
    if (on === this.on) return this.on;
    this.on = on;
    for (const listener of this.listeners) listener(on);
    return this.on;
  }

  subscribe(listener: (on: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
