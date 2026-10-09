import { describe, expect, it } from 'vitest';
import { EMPTY_SELECTION, select, selectAll, visibleSelection } from './selection';

const order = [10, 20, 30, 40, 50];

describe('select', () => {
  it('toggles single items and moves the anchor', () => {
    let selection = select(EMPTY_SELECTION, order, 20, 'toggle');
    selection = select(selection, order, 40, 'toggle');
    expect([...selection.ids]).toEqual([20, 40]);
    selection = select(selection, order, 20, 'toggle');
    expect([...selection.ids]).toEqual([40]);
    expect(selection.anchor).toBe(20);
  });

  it('adds the range from the anchor in either direction', () => {
    const selection = select(select(EMPTY_SELECTION, order, 40, 'toggle'), order, 20, 'range');
    expect([...selection.ids].sort()).toEqual([20, 30, 40]);
    expect(selection.anchor).toBe(40);
  });

  it('keeps what was already selected when a range is added', () => {
    let selection = select(EMPTY_SELECTION, order, 10, 'toggle');
    selection = select(selection, order, 30, 'toggle');
    selection = select(selection, order, 50, 'range');
    expect([...selection.ids].sort()).toEqual([10, 30, 40, 50]);
  });

  it('treats Shift without an anchor as a toggle', () => {
    expect([...select(EMPTY_SELECTION, order, 30, 'range').ids]).toEqual([30]);
  });

  it('treats Shift with an anchor that is no longer listed as a toggle', () => {
    const selection = select({ ids: new Set([99]), anchor: 99 }, order, 30, 'range');
    expect([...selection.ids].sort((a, b) => a - b)).toEqual([30, 99]);
    expect(selection.anchor).toBe(30);
  });
});

describe('selectAll', () => {
  it('selects every listed item and drops the anchor', () => {
    const selection = selectAll(order);
    expect([...selection.ids]).toEqual(order);
    expect(selection.anchor).toBeNull();
  });
});

describe('visibleSelection', () => {
  it('keeps only listed ids, in list order', () => {
    expect(visibleSelection({ ids: new Set([50, 99, 10]), anchor: null }, order)).toEqual([10, 50]);
  });
});
