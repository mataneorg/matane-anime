import type { ExtensionInfo, ExtensionLogEntry } from '@matane-anime/shared';
import { describe, expect, it } from 'vitest';
import { LEVELS, logLines, logText, mergeLogs } from './logs';

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

describe('mergeLogs', () => {
  it('keeps what was fetched and adds the lines that arrived live meanwhile', () => {
    const merged = mergeLogs(
      [entry('a', 'info', 1, 'one'), entry('a', 'info', 2, 'two')],
      [entry('a', 'warn', 3, 'three')],
    );
    expect(merged.map((line) => line.message)).toEqual(['one', 'two', 'three']);
  });

  it('keeps a line once when it is both fetched and live', () => {
    const shared = entry('a', 'info', 2, 'two');
    const merged = mergeLogs([entry('a', 'info', 1, 'one'), shared], [{ ...shared }, entry('a', 'info', 3, 'three')]);
    expect(merged.map((line) => line.message)).toEqual(['one', 'two', 'three']);
  });

  it('keeps identical lines that really happened twice in the fetched list', () => {
    const twice = [entry('a', 'info', 1, 'same'), entry('a', 'info', 1, 'same')];
    expect(mergeLogs(twice, [])).toHaveLength(2);
  });

  it('orders by time when a live line is older than the last fetched one, and keeps the newest `limit`', () => {
    const merged = mergeLogs([entry('a', 'info', 5, 'late')], [entry('a', 'info', 4, 'early')]);
    expect(merged.map((line) => line.message)).toEqual(['early', 'late']);
    const many = Array.from({ length: 10 }, (_, i) => entry('a', 'info', i, `m${i}`));
    expect(mergeLogs(many, [], 3).map((line) => line.message)).toEqual(['m7', 'm8', 'm9']);
  });

  it('is empty without lines', () => {
    expect(mergeLogs([], [])).toEqual([]);
  });
});
