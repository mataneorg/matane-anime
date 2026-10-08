import type { ExtensionInfo, ExtensionLogEntry } from '@matane-anime/shared';
import { describe, expect, it } from 'vitest';
import { LEVELS, logLines, logText } from './logs';

const entry = (
  extensionId: string,
  level: ExtensionLogEntry['level'],
  at: number,
  message = 'm',
): ExtensionLogEntry => ({
  extensionId,
  level,
  message,
  at,
});
const broken = {
  id: '/dev/x',
  folder: '/dev/x',
  origin: 'dev',
  status: 'error',
  error: 'bad manifest',
} as ExtensionInfo;
const fine = { id: 'ok', folder: '/dev/ok', origin: 'dev', status: 'ready', error: null } as ExtensionInfo;
const all = { extensionId: 'all', levels: new Set(LEVELS), clearedAt: 0 } as const;

describe('logLines', () => {
  const entries = [entry('a', 'info', 1), entry('b', 'error', 2), entry('a', 'debug', 3)];
  it('puts the load errors of failed dev folders first, without a time', () => {
    const lines = logLines(entries, [broken, fine], all);
    expect(lines[0]).toEqual({ level: 'error', source: '/dev/x', message: 'bad manifest', at: null });
    expect(lines).toHaveLength(4);
  });
  it('narrows by extension and level', () => {
    expect(logLines(entries, [], { ...all, extensionId: 'a' }).map((l) => l.at)).toEqual([1, 3]);
    expect(logLines(entries, [broken], { ...all, levels: new Set(['info']) }).map((l) => l.at)).toEqual([1]);
    expect(logLines(entries, [broken], { ...all, extensionId: 'b' }).map((l) => l.source)).toEqual(['b']);
  });
  it('hides what was logged before it was cleared, but not a load error', () => {
    const lines = logLines(entries, [broken], { ...all, clearedAt: 2 });
    expect(lines.map((l) => l.at)).toEqual([null, 3]);
  });
});

describe('logText', () => {
  it('writes one line per entry for the clipboard', () => {
    const text = logText([
      { level: 'error', source: '/dev/x', message: 'bad manifest', at: null },
      { level: 'warn', source: 'a', message: 'slow', at: Date.UTC(2026, 0, 1) },
    ]);
    expect(text).toBe('ERROR [/dev/x] bad manifest\n2026-01-01T00:00:00.000Z WARN [a] slow');
  });
});
