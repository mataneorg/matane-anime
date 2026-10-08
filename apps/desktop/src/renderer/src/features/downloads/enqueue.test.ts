import { describe, expect, it } from 'vitest';
import { summarizeEnqueue } from './enqueue';

describe('summarizeEnqueue', () => {
  it('counts what was queued and what was there already', () => {
    expect(summarizeEnqueue({ queued: [1, 2], existing: [3], refused: [] })).toEqual({
      queued: 2,
      existing: 1,
      overLimit: [],
      refused: [],
    });
  });
  it('sets the size-limit refusals apart: those may be forced after a confirmation', () => {
    const feedback = summarizeEnqueue({
      queued: [1],
      existing: [],
      refused: [
        { episodeId: 2, reason: 'size_limit' },
        { episodeId: 3, reason: 'live' },
        { episodeId: 4, reason: 'size_limit' },
        { episodeId: 5, reason: 'live' },
        { episodeId: 6, reason: 'disk_space' },
      ],
    });
    expect(feedback.overLimit).toEqual([2, 4]);
    expect(feedback.refused).toEqual([
      { reason: 'live', count: 2 },
      { reason: 'disk_space', count: 1 },
    ]);
  });
});
