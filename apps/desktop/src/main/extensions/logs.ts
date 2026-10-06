import type { ExtensionLogEntry } from '@matane-anime/shared';

const PER_EXTENSION = 500;

/** The last log lines of each extension, for the developer panel (docs/PRD.md EXT-10). Memory only. */
export class ExtensionLogs {
  private readonly entries = new Map<string, ExtensionLogEntry[]>();
  private readonly listeners = new Set<(entry: ExtensionLogEntry) => void>();

  subscribe(listener: (entry: ExtensionLogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  push(entry: ExtensionLogEntry): void {
    const list = this.entries.get(entry.extensionId) ?? [];
    list.push(entry);
    if (list.length > PER_EXTENSION) list.splice(0, list.length - PER_EXTENSION);
    this.entries.set(entry.extensionId, list);
    for (const listener of this.listeners) listener(entry);
  }

  list(extensionId?: string): ExtensionLogEntry[] {
    if (extensionId) return [...(this.entries.get(extensionId) ?? [])];
    return [...this.entries.values()].flat().sort((a, b) => a.at - b.at);
  }
}
