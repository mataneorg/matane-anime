import { z } from 'zod';

/** What the player's keyboard can do (docs/PRD.md PLY-3). `back-long` and `forward-long` seek twice the arrow step. */
export const PLAYER_ACTIONS = [
  'play-pause',
  'back',
  'forward',
  'back-long',
  'forward-long',
  'volume-up',
  'volume-down',
  'mute',
  'fullscreen',
  'next',
  'previous',
  'slower',
  'faster',
] as const;
export type PlayerAction = (typeof PLAYER_ACTIONS)[number];

/** Action -> key combinations. A combination is written like `Space`, `K`, `ArrowLeft`, `[` or `Shift+N`. */
export type ShortcutMap = Record<PlayerAction, string[]>;

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  'play-pause': ['Space', 'K'],
  back: ['ArrowLeft'],
  forward: ['ArrowRight'],
  'back-long': ['J'],
  'forward-long': ['L'],
  'volume-up': ['ArrowUp'],
  'volume-down': ['ArrowDown'],
  mute: ['M'],
  fullscreen: ['F'],
  next: ['Shift+N'],
  previous: ['Shift+P'],
  slower: ['['],
  faster: [']'],
};

/** Keys that cannot be bound: Escape closes panels and leaves the player. */
export const RESERVED_COMBOS: readonly string[] = ['Escape'];

/** The parts of a keyboard event the helpers read, so they run without a DOM. */
export interface KeyEventLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

// Keys that never make a combination on their own (or that move focus around).
const IGNORED_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'OS',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Fn',
  'Dead',
  'Unidentified',
  'Process',
  'Tab',
]);

const isLetter = (key: string): boolean => key.length === 1 && key.toLowerCase() !== key.toUpperCase();

/**
 * The combination a key press stands for, or null when it cannot be one: a lone modifier, a
 * press with Ctrl, Alt or Meta held (those belong to the app and the system), or a dead key.
 * Shift is written only for letters and named keys: `Shift+N`, `Shift+ArrowLeft`, but `{` alone.
 */
export function eventToCombo(event: KeyEventLike): string | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  const { key } = event;
  if (key === '' || IGNORED_KEYS.has(key)) return null;
  const name = key === ' ' ? 'Space' : isLetter(key) ? key.toUpperCase() : key;
  const named = name.length > 1;
  return event.shiftKey && (named || isLetter(key)) ? `Shift+${name}` : name;
}

/** The action a combination triggers, or null. */
export function resolveAction(map: ShortcutMap, combo: string): PlayerAction | null {
  for (const action of PLAYER_ACTIONS) if (map[action].includes(combo)) return action;
  return null;
}

/** The other action that already uses `combo`, or null when it is free for `action`. */
export function findConflict(map: ShortcutMap, action: PlayerAction, combo: string): PlayerAction | null {
  for (const other of PLAYER_ACTIONS) if (other !== action && map[other].includes(combo)) return other;
  return null;
}

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

/** What to print on a key cap: `Shift+N` becomes `Shift N`, the arrows become arrows. */
export function formatCombo(combo: string): string {
  return combo
    .split('+')
    .map((part) => KEY_LABELS[part] ?? part)
    .join(' ');
}

const comboSchema = z
  .string()
  .min(1)
  .max(24)
  .refine((combo) => !RESERVED_COMBOS.includes(combo), 'reserved');

/** Every action bound to one to four combinations, and no combination bound twice. */
export const shortcutMapSchema = z
  .object(
    Object.fromEntries(PLAYER_ACTIONS.map((action) => [action, z.array(comboSchema).min(1).max(4)])) as Record<
      PlayerAction,
      z.ZodArray<typeof comboSchema>
    >,
  )
  .refine((map) => {
    const seen = new Set<string>();
    for (const action of PLAYER_ACTIONS)
      for (const combo of map[action]) {
        if (seen.has(combo)) return false;
        seen.add(combo);
      }
    return true;
  }, 'a combination is bound twice');
