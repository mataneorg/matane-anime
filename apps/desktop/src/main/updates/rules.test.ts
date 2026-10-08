import { describe, expect, it } from 'vitest';
import {
  type AutoDownloadMode,
  type SkipRules,
  type SkipSubject,
  autoDownloadAllowed,
  onePerNumber,
  skipReason,
} from './rules';

const rules: SkipRules = { updateSkipCompleted: true, updateSkipNotStarted: true, updateSkipUnwatchedOver: 3 };
const off: SkipRules = { updateSkipCompleted: false, updateSkipNotStarted: false, updateSkipUnwatchedOver: null };

function anime(overrides: Partial<SkipSubject> = {}, unwatched = 0, watched = 2): SkipSubject {
  let id = 0;
  const make = (isWatched: boolean) => ({
    id: ++id,
    number: id,
    watched: isWatched,
    sourceMissing: false,
    positionMs: 0,
  });
  return {
    status: 'ongoing',
    hasHistory: true,
    hasSession: true,
    episodes: [
      ...Array.from({ length: watched }, () => make(true)),
      ...Array.from({ length: unwatched }, () => make(false)),
    ],
    ...overrides,
  };
}

describe('skip rules (UPD-3)', () => {
  it('checks an ordinary anime', () => {
    expect(skipReason(anime(), rules)).toBeNull();
  });

  it('skips completed anime, unless the rule is off', () => {
    expect(skipReason(anime({ status: 'completed' }), rules)).toBe('completed');
    expect(skipReason(anime({ status: 'completed' }), { ...rules, updateSkipCompleted: false })).toBeNull();
    expect(skipReason(anime({ status: 'hiatus' }), rules)).toBeNull();
  });

  it('skips an anime that was never watched: no history, no session, nothing watched or started', () => {
    const untouched = anime({ hasHistory: false, hasSession: false }, 2, 0);
    expect(skipReason(untouched, rules)).toBe('not_started');
    expect(skipReason(untouched, { ...rules, updateSkipNotStarted: false })).toBeNull();
  });

  it.each([
    ['history', { hasHistory: true, hasSession: false }],
    ['a session', { hasHistory: false, hasSession: true }],
  ])('counts %s as started', (_name, flags) => {
    expect(skipReason(anime({ ...flags }, 2, 0), rules)).toBeNull();
  });

  it('counts a watched episode, or a saved position, as started', () => {
    expect(skipReason(anime({ hasHistory: false, hasSession: false }, 1, 1), rules)).toBeNull();
    const started = anime({ hasHistory: false, hasSession: false }, 2, 0);
    started.episodes[0]!.positionMs = 5000;
    expect(skipReason(started, rules)).toBeNull();
  });

  it('skips when more than N episodes are unwatched, not exactly N', () => {
    expect(skipReason(anime({}, 3), rules)).toBeNull();
    expect(skipReason(anime({}, 4), rules)).toBe('too_many_unwatched');
    expect(skipReason(anime({}, 400), { ...rules, updateSkipUnwatchedOver: null })).toBeNull();
  });

  it('counts unwatched per episode number and ignores episodes the source dropped', () => {
    // Four rows, but Sub and Dub of 1 and 2 are two episodes.
    const variants = anime({}, 0, 0);
    variants.episodes = [1, 1, 2, 2].map((number, index) => ({
      id: index,
      number,
      watched: false,
      sourceMissing: false,
      positionMs: 0,
    }));
    expect(skipReason(variants, { ...rules, updateSkipUnwatchedOver: 2 })).toBeNull();
    const dropped = anime({}, 6);
    for (const episode of dropped.episodes.slice(-3)) episode.sourceMissing = true;
    expect(skipReason(dropped, rules)).toBeNull();
  });

  it('applies the rules in order and does nothing with all of them off', () => {
    expect(skipReason(anime({ status: 'completed', hasHistory: false, hasSession: false }, 9, 0), rules)).toBe(
      'completed',
    );
    expect(skipReason(anime({ status: 'completed', hasHistory: false, hasSession: false }, 9, 0), off)).toBeNull();
  });
});

describe('auto-download per category (DL-11)', () => {
  const modes = (entries: [number, AutoDownloadMode][]) => new Map(entries);

  it('allows everything when no category is marked', () => {
    expect(autoDownloadAllowed([], modes([]))).toBe(true);
    expect(autoDownloadAllowed([1, 2], modes([]))).toBe(true);
  });

  it('keeps out anime in an excluded category, even if another category includes them (exclude wins)', () => {
    const marks = modes([
      [1, 'include'],
      [2, 'exclude'],
    ]);
    expect(autoDownloadAllowed([2], marks)).toBe(false);
    expect(autoDownloadAllowed([1, 2], marks)).toBe(false);
  });

  it('with only excludes, anime outside them (and in no category) are allowed', () => {
    const marks = modes([[2, 'exclude']]);
    expect(autoDownloadAllowed([], marks)).toBe(true);
    expect(autoDownloadAllowed([1], marks)).toBe(true);
    expect(autoDownloadAllowed([1, 2], marks)).toBe(false);
  });

  it('once any category is included, only anime in an included category are allowed', () => {
    const marks = modes([[1, 'include']]);
    expect(autoDownloadAllowed([1], marks)).toBe(true);
    expect(autoDownloadAllowed([1, 3], marks)).toBe(true);
    expect(autoDownloadAllowed([3], marks)).toBe(false);
    expect(autoDownloadAllowed([], marks)).toBe(false);
  });
});

describe('onePerNumber', () => {
  it('keeps the variant the source lists first, per anime and number', () => {
    const picked = onePerNumber([
      { episodeId: 1, animeId: 1, number: 5, sourceOrder: 3 },
      { episodeId: 2, animeId: 1, number: 5, sourceOrder: 2 },
      { episodeId: 3, animeId: 2, number: 5, sourceOrder: 0 },
      { episodeId: 4, animeId: 1, number: null, sourceOrder: 1 },
      { episodeId: 5, animeId: 1, number: null, sourceOrder: 0 },
    ]);
    expect(picked.map((episode) => episode.episodeId).sort()).toEqual([2, 3, 4, 5]);
  });
});
