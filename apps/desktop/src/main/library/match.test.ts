import { describe, expect, it } from 'vitest';
import { type MatchEpisode, type OldEpisode, planMigration } from './match';

const next = (
  id: number,
  number: number | null,
  variant: string | null = null,
  name = `Episode ${number}`,
): MatchEpisode => ({ id, number, variant, name, sourceOrder: 100 - id });
const old = (id: number, number: number | null, over: Partial<OldEpisode> = {}): OldEpisode => ({
  ...next(id, number, over.variant ?? null, over.name),
  watched: false,
  watchedAt: null,
  positionMs: 0,
  durationMs: null,
  ...over,
});

describe('planMigration (BRW-8)', () => {
  it('matches by episode number and carries the state', () => {
    const plan = planMigration(
      [
        old(1, 1, { watched: true, watchedAt: 50, positionMs: 1000, durationMs: 1440 }),
        old(2, 2, { positionMs: 600_000, durationMs: 1_440_000 }),
        old(3, 3),
      ],
      [next(11, 1), next(12, 2), next(13, 3), next(14, 4)],
    );
    expect(plan.unmatched).toEqual([]);
    expect(plan.transfers).toEqual([
      { to: 11, state: { watched: true, watchedAt: 50, positionMs: 1000, durationMs: 1440 }, from: [1] },
      { to: 12, state: { watched: false, watchedAt: null, positionMs: 600_000, durationMs: 1_440_000 }, from: [2] },
    ]);
  });

  it('ignores episodes with nothing to carry', () => {
    const plan = planMigration([old(1, 1), old(2, 2)], [next(11, 1)]);
    expect(plan).toEqual({ transfers: [], unmatched: [] });
  });

  it('reports watched or started episodes the new source does not have', () => {
    const plan = planMigration(
      [old(1, 1, { watched: true }), old(2, 13, { positionMs: 5000 })],
      [next(11, 1), next(12, 2)],
    );
    expect(plan.unmatched.map((e) => e.number)).toEqual([13]);
    expect(plan.transfers.map((t) => t.to)).toEqual([11]);
  });

  it('prefers the same variant, then any variant of the number', () => {
    // Listed in this order by the source: Sub first.
    const subDub = [
      { ...next(11, 1, 'Sub'), sourceOrder: 0 },
      { ...next(12, 1, 'Dub'), sourceOrder: 1 },
    ];
    expect(planMigration([old(1, 1, { variant: 'Dub', watched: true })], subDub).transfers[0]?.to).toBe(12);
    expect(planMigration([old(1, 1, { variant: 'BD', watched: true })], subDub).transfers[0]?.to).toBe(11);
  });

  it('merges the variants of a number into one new episode, keeping the state that is further along', () => {
    const plan = planMigration(
      [
        old(1, 1, { variant: 'Sub', positionMs: 300_000 }),
        old(2, 1, { variant: 'Dub', watched: true }),
        old(3, 2, { variant: 'Sub', positionMs: 100 }),
        old(4, 2, { variant: 'Dub', positionMs: 900 }),
      ],
      [next(11, 1), next(12, 2)],
    );
    expect(plan.transfers).toEqual([
      { to: 11, state: expect.objectContaining({ watched: true }), from: [1, 2] },
      { to: 12, state: expect.objectContaining({ positionMs: 900 }), from: [3, 4] },
    ]);
  });

  it('matches episodes without a number by their name', () => {
    const plan = planMigration(
      [old(1, null, { name: 'Special  Episode', watched: true }), old(2, null, { name: 'Other', watched: true })],
      [next(11, null, null, 'special episode')],
    );
    expect(plan.transfers.map((t) => t.to)).toEqual([11]);
    expect(plan.unmatched.map((e) => e.name)).toEqual(['Other']);
  });

  it('does not match a numbered episode to a numberless one', () => {
    expect(planMigration([old(1, 1, { watched: true })], [next(11, null, null, 'Episode 1')]).unmatched).toHaveLength(
      1,
    );
  });
});
