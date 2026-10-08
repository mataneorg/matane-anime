import { describe, expect, it } from 'vitest';
import { continueTarget } from './continue';
import { RESUME_REWIND_MS, countEpisodes, reachedThreshold, resumePosition, watchOrder } from './rules';

describe('reachedThreshold (PRG-3)', () => {
  it('marks watched at the threshold, not before', () => {
    expect(reachedThreshold(84_000, 100_000, 85, false)).toBe(false);
    expect(reachedThreshold(85_000, 100_000, 85, false)).toBe(true);
    expect(reachedThreshold(50_000, 100_000, 50, false)).toBe(true);
  });

  it('at 100% only the end of the video counts', () => {
    expect(reachedThreshold(99_900, 100_000, 100, false)).toBe(false);
    expect(reachedThreshold(100_000, 100_000, 100, true)).toBe(true);
  });

  it('a finished video is watched even without a known duration', () => {
    expect(reachedThreshold(0, null, 85, true)).toBe(true);
    expect(reachedThreshold(90_000, null, 85, false)).toBe(false);
    expect(reachedThreshold(90_000, 0, 85, false)).toBe(false);
  });
});

describe('resumePosition (PRG-4)', () => {
  const at = (positionMs: number, watched = false, durationMs: number | null = 1_440_000) => ({
    positionMs,
    durationMs,
    watched,
  });

  it('goes back three seconds from a position past ten seconds', () => {
    expect(resumePosition(at(60_000), 85)).toBe(60_000 - RESUME_REWIND_MS);
    expect(resumePosition(at(10_001), 85)).toBe(10_001 - RESUME_REWIND_MS);
  });

  it('starts over for a position of ten seconds or less, a watched episode, or one past the threshold', () => {
    expect(resumePosition(at(10_000), 85)).toBe(0);
    expect(resumePosition(at(0), 85)).toBe(0);
    expect(resumePosition(at(900_000, true), 85)).toBe(0);
    expect(resumePosition(at(1_300_000), 85)).toBe(0);
  });

  it('follows the user threshold', () => {
    expect(resumePosition(at(800_000), 50)).toBe(0); // past 50%: counts as finished
    expect(resumePosition(at(800_000), 100)).toBe(797_000);
  });
});

describe('countEpisodes (PRG-5)', () => {
  const ep = (id: number, number: number | null, watched: boolean, sourceMissing = false) => ({
    id,
    number,
    watched,
    sourceMissing,
  });

  it('counts a number once however many variants it has', () => {
    const rows = [ep(1, 3, false), ep(2, 3, false), ep(3, 2, true), ep(4, 2, true), ep(5, 1, true)];
    expect(countEpisodes(rows)).toEqual({ total: 3, unwatched: 1 });
  });

  it('counts episodes without a number one by one, and ignores the ones the source dropped', () => {
    const rows = [ep(1, null, false), ep(2, null, false), ep(3, 1, false, true)];
    expect(countEpisodes(rows)).toEqual({ total: 2, unwatched: 2 });
  });

  it('a number is unwatched while any of its variants is', () => {
    expect(countEpisodes([ep(1, 4, true), ep(2, 4, false)]).unwatched).toBe(1);
  });
});

describe('continueTarget (PRG-6)', () => {
  const ep = (
    id: number,
    number: number | null,
    over: Partial<{ variant: string | null; watched: boolean; positionMs: number; sourceMissing: boolean }> = {},
  ) => ({
    id,
    number,
    variant: over.variant ?? null,
    sourceOrder: 100 - id,
    watched: over.watched ?? false,
    positionMs: over.positionMs ?? 0,
    durationMs: 1_440_000,
    sourceMissing: over.sourceMissing ?? false,
  });

  it('picks the first episode when nothing was watched', () => {
    const rows = [ep(3, 3), ep(2, 2), ep(1, 1)];
    expect(continueTarget(rows, null, 85)).toMatchObject({ reason: 'first', episode: { id: 1 }, resumeMs: 0 });
  });

  it('resumes the last opened episode while it is unfinished', () => {
    const rows = [ep(3, 3), ep(2, 2, { positionMs: 600_000 }), ep(1, 1, { watched: true })];
    expect(continueTarget(rows, 2, 85)).toMatchObject({ reason: 'resume', episode: { id: 2 }, resumeMs: 597_000 });
  });

  it('moves to the next unwatched episode by number once the last one is finished', () => {
    const rows = [ep(3, 3), ep(2, 2, { watched: true }), ep(1, 1, { watched: true })];
    expect(continueTarget(rows, 2, 85)).toMatchObject({ reason: 'next', episode: { id: 3 } });
  });

  it('skips ahead of episodes that were skipped, then falls back to the earliest skipped one', () => {
    const skipped = [ep(5, 5), ep(4, 4, { watched: true }), ep(3, 3), ep(2, 2), ep(1, 1)];
    expect(continueTarget(skipped, 4, 85)).toMatchObject({ episode: { id: 5 } });
    const rewatch = [ep(3, 3, { watched: true }), ep(2, 2), ep(1, 1, { watched: true })];
    expect(continueTarget(rewatch, 3, 85)).toMatchObject({ reason: 'next', episode: { id: 2 } });
  });

  it('without history, counts from the latest episode that is marked watched', () => {
    const rows = [ep(4, 4), ep(3, 3), ep(2, 2, { watched: true }), ep(1, 1, { watched: true })];
    expect(continueTarget(rows, null, 85)).toMatchObject({ reason: 'next', episode: { id: 3 } });
    // Nothing is watched and there is no history: the beginning.
    expect(continueTarget([ep(2, 2), ep(1, 1)], null, 85)).toMatchObject({ reason: 'first', episode: { id: 1 } });
  });

  it('has nothing to continue when everything is watched', () => {
    expect(continueTarget([ep(2, 2, { watched: true }), ep(1, 1, { watched: true })], 2, 85)).toBeNull();
    expect(continueTarget([], null, 85)).toBeNull();
  });

  it('stays in the variant being watched', () => {
    const rows = [
      ep(4, 2, { variant: 'Dub' }),
      ep(3, 2, { variant: 'Sub' }),
      ep(2, 1, { variant: 'Dub', watched: true }),
      ep(1, 1, { variant: 'Sub', watched: true }),
    ];
    expect(continueTarget(rows, 2, 85)).toMatchObject({ episode: { id: 4 } });
    expect(continueTarget(rows, 1, 85)).toMatchObject({ episode: { id: 3 } });
  });

  it('skips what the source no longer lists, even the last opened episode', () => {
    const rows = [ep(3, 3), ep(2, 2, { sourceMissing: true, positionMs: 600_000 }), ep(1, 1, { watched: true })];
    expect(continueTarget(rows, 2, 85)).toMatchObject({ reason: 'next', episode: { id: 3 } });
  });

  it('orders by number, then by the source order for numberless episodes', () => {
    expect(watchOrder(ep(1, 1), ep(2, 2))).toBeLessThan(0);
    // Newest first: the higher the source order, the earlier the episode.
    expect(watchOrder(ep(1, null), ep(2, null))).toBeLessThan(0);
  });
});
