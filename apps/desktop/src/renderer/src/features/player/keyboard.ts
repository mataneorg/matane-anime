/** The parts of a focused element the keyboard handler reads, so it runs without a DOM. */
export interface KeyTargetLike {
  tagName: string;
  isContentEditable?: boolean;
  getAttribute(name: string): string | null;
  matches?(selector: string): boolean;
}

// Keys that activate a focused button, link or menu item.
const ACTIVATION_COMBOS = new Set(['Space', 'Enter']);
const ACTIVATABLE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'switch',
  'checkbox',
  'radio',
  'option',
]);

/**
 * Whether the player's shortcuts should leave this key press alone. Text fields keep every key. A control the
 * user reached with the keyboard keeps Space and Enter, which activate it; a control that only has focus because
 * it was clicked does not, so Space still pauses after a click on the mute button.
 */
export function shouldIgnoreKey(target: KeyTargetLike | null, combo: string | null): boolean {
  if (!target) return false;
  const tag = target.tagName.toUpperCase();
  if (tag === 'INPUT') return target.getAttribute('type') !== 'range';
  if (tag === 'SELECT' || tag === 'TEXTAREA' || target.isContentEditable) return true;
  if (combo === null || !ACTIVATION_COMBOS.has(combo)) return false;
  const activatable = tag === 'BUTTON' || tag === 'A' || ACTIVATABLE_ROLES.has(target.getAttribute('role') ?? '');
  return activatable && (target.matches?.(':focus-visible') ?? true);
}
