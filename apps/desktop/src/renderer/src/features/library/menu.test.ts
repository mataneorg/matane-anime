import { describe, expect, it } from 'vitest';
import { cardMenuRows, menuTargetIds, movedCategoryIds, toggledAutoDownload } from './menu';

describe('menuTargetIds', () => {
  it('acts on the whole selection when the card is part of it', () => {
    expect(menuTargetIds(new Set([3, 5, 9]), 5)).toEqual([3, 5, 9]);
  });

  it('acts on the card alone when it is outside the selection', () => {
    expect(menuTargetIds(new Set([3, 5]), 9)).toEqual([9]);
  });

  it('acts on the card alone when nothing is selected', () => {
    expect(menuTargetIds(new Set(), 9)).toEqual([9]);
  });

  it('keeps a selection of one as it is', () => {
    expect(menuTargetIds(new Set([9]), 9)).toEqual([9]);
  });
});

describe('cardMenuRows', () => {
  it('offers everything for a plain card with something to continue', () => {
    expect(cardMenuRows({ canContinue: true, selected: false, targetCount: 1 })).toEqual({
      continue: true,
      open: true,
      migrate: true,
      select: true,
    });
  });

  it('hides Continue when there is nothing to continue', () => {
    expect(cardMenuRows({ canContinue: false, selected: false, targetCount: 1 }).continue).toBe(false);
  });

  it('keeps only the bulk actions for several anime', () => {
    expect(cardMenuRows({ canContinue: true, selected: true, targetCount: 3 })).toEqual({
      continue: false,
      open: false,
      migrate: false,
      select: false,
    });
  });

  it('does not offer Select for a card that is already selected', () => {
    expect(cardMenuRows({ canContinue: true, selected: true, targetCount: 1 }).select).toBe(false);
  });
});

describe('movedCategoryIds', () => {
  it('moves a category one place left or right', () => {
    expect(movedCategoryIds([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(movedCategoryIds([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
  });

  it('leaves the order alone at either end or for an unknown id', () => {
    expect(movedCategoryIds([1, 2, 3], 1, -1)).toEqual([1, 2, 3]);
    expect(movedCategoryIds([1, 2, 3], 3, 1)).toEqual([1, 2, 3]);
    expect(movedCategoryIds([1, 2, 3], 9, 1)).toEqual([1, 2, 3]);
  });
});

describe('toggledAutoDownload', () => {
  it('includes an unmarked or excluded category and clears an included one', () => {
    expect(toggledAutoDownload(null)).toBe('include');
    expect(toggledAutoDownload('exclude')).toBe('include');
    expect(toggledAutoDownload('include')).toBeNull();
  });
});
