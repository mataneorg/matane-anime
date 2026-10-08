import type { ExtensionInfo, ExtensionLogEntry } from '@matane-anime/shared';

export const LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LEVELS)[number];

/** One line of the log panel. A load error has no time: it is what the extension looked like when loading failed. */
export interface LogLine {
  level: LogLevel;
  source: string;
  message: string;
  at: number | null;
}

export interface LogFilter {
  /** `all`, or an extension id. */
  extensionId: string;
  levels: ReadonlySet<LogLevel>;
  /** Lines logged before this moment were cleared from the panel. */
  clearedAt: number;
}

/**
 * What the panel shows: the load errors of folders that failed (first, as `error` lines), then the extensions' log in
 * order, narrowed by extension and level. Clearing hides what was logged so far; load errors stay until fixed.
 */
export function logLines(
  entries: readonly ExtensionLogEntry[],
  extensions: readonly ExtensionInfo[],
  filter: LogFilter,
): LogLine[] {
  const failed: LogLine[] = extensions
    .filter((extension) => extension.origin === 'dev' && extension.status === 'error' && extension.error)
    .filter((extension) => filter.extensionId === 'all' || extension.id === filter.extensionId)
    .map((extension) => ({
      level: 'error' as const,
      source: extension.folder ?? extension.id,
      message: extension.error as string,
      at: null,
    }));
  const logged: LogLine[] = entries
    .filter((entry) => entry.at > filter.clearedAt)
    .filter((entry) => filter.extensionId === 'all' || entry.extensionId === filter.extensionId)
    .map((entry) => ({ level: entry.level, source: entry.extensionId, message: entry.message, at: entry.at }));
  return [...failed, ...logged].filter((line) => filter.levels.has(line.level));
}

/** The lines as plain text for the clipboard: `12:00:01 [error] [example] message`. */
export function logText(lines: readonly LogLine[]): string {
  return lines
    .map((line) => {
      const time = line.at === null ? '' : `${new Date(line.at).toISOString()} `;
      return `${time}${line.level.toUpperCase()} [${line.source}] ${line.message}`;
    })
    .join('\n');
}
