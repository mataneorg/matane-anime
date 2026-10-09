/** How a click changes a multi-selection: Ctrl toggles one item, Shift adds the range from the anchor. */
export type SelectMode = 'toggle' | 'range';

export interface Selection {
  ids: ReadonlySet<number>;
  /** Last item clicked without Shift; Shift+click selects from here. */
  anchor: number | null;
}

export const EMPTY_SELECTION: Selection = { ids: new Set(), anchor: null };

/** The new selection after `id` was clicked. Shift with no anchor (or an anchor that is gone) acts as a toggle. */
export function select(current: Selection, order: readonly number[], id: number, mode: SelectMode): Selection {
  if (mode === 'range' && current.anchor !== null) {
    const from = order.indexOf(current.anchor);
    const to = order.indexOf(id);
    if (from >= 0 && to >= 0) {
      const ids = new Set(current.ids);
      for (const item of order.slice(Math.min(from, to), Math.max(from, to) + 1)) ids.add(item);
      return { ids, anchor: current.anchor };
    }
  }
  const ids = new Set(current.ids);
  if (!ids.delete(id)) ids.add(id);
  return { ids, anchor: id };
}

/** Everything listed. */
export function selectAll(order: readonly number[]): Selection {
  return { ids: new Set(order), anchor: null };
}

/** Selected ids that are still listed, in list order (items can vanish after a filter or a removal). */
export function visibleSelection(selection: Selection, order: readonly number[]): number[] {
  return order.filter((id) => selection.ids.has(id));
}

/** What a click or key press must offer to change a selection: the modifiers, and a way to cancel the default. */
export interface PickEvent {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  preventDefault: () => void;
}
