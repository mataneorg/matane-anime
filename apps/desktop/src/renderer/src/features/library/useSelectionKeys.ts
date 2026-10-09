import { useEffect } from 'react';
import { type Selection, selectAll } from './selection';

/** Typing in a field must keep Ctrl+A, Escape and the like for itself. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/** A dialog, popover, menu or listbox on screen owns the keyboard (Escape closes it, Ctrl+A is for its content). */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * Ctrl/Cmd+A selects everything in `order`, Escape lets go. Neither fires while typing, over an open dialog,
 * popover or menu, nor when something else already handled the key. `onSelect` and `onClear` should be stable.
 */
export function useSelectionKeys(
  order: readonly number[],
  onSelect: (selection: Selection) => void,
  onClear: () => void,
): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || isTyping(event.target) || document.querySelector(OVERLAY)) return;
      if (event.key === 'Escape') onClear();
      else if (event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        onSelect(selectAll(order));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [order, onSelect, onClear]);
}
