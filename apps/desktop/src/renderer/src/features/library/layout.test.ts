import { describe, expect, it } from 'vitest';
import { LIST_ROW_HEIGHT, columnCount, gridGap, gridLayout } from './layout';

describe('columnCount', () => {
  it('fits as many cards of the size as the width holds, counting the gaps', () => {
    expect(columnCount(1000, 160, 10)).toBe(5); // 5 × 160 + 4 × 10 = 840; a sixth needs 1010
    expect(columnCount(1010, 160, 10)).toBe(6);
    expect(columnCount(355, 170, 16)).toBe(1); // two need 2 × 170 + 16 = 356
    expect(columnCount(356, 170, 16)).toBe(2);
  });
  it('is never below one', () => {
    expect(columnCount(0, 160, 10)).toBe(1);
    expect(columnCount(50, 280, 16)).toBe(1);
  });
});

describe('gridLayout', () => {
  it('gives the list one fixed-height column', () => {
    expect(gridLayout('list', 900, 160)).toEqual({ columns: 1, gap: 0, rowHeight: LIST_ROW_HEIGHT });
  });
  it('leaves room for the text under comfortable covers only', () => {
    const comfortable = gridLayout('comfortable', 1000, 160);
    const compact = gridLayout('compact', 1000, 160);
    const cover = gridLayout('cover', 1000, 160);
    expect(compact.rowHeight).toBe(cover.rowHeight);
    // Same 2:3 cover and same gap logic: the comfortable row is the cover, the text and its larger gap.
    const cardWidth = (1000 - 16 * (comfortable.columns - 1)) / comfortable.columns;
    expect(comfortable.rowHeight).toBe(Math.round(cardWidth * 1.5 + 60 + 16));
    expect(gridGap('comfortable')).toBe(16);
    expect(gridGap('cover')).toBe(10);
  });
  it('makes cards wider (fewer columns) as the size grows', () => {
    expect(gridLayout('compact', 1000, 100).columns).toBeGreaterThan(gridLayout('compact', 1000, 280).columns);
  });
  it('has a row for an unmeasured width', () => {
    expect(gridLayout('comfortable', 0, 160)).toMatchObject({ columns: 1 });
  });
});
