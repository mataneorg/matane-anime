import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, settingsFromStored, settingsPatchSchema } from './settings';
import {
  DEFAULT_SHORTCUTS,
  PLAYER_ACTIONS,
  type KeyEventLike,
  eventToCombo,
  findConflict,
  formatCombo,
  resolveAction,
  shortcutMapSchema,
} from './shortcuts';

const press = (key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe('eventToCombo', () => {
  it('names keys the way the defaults do', () => {
    expect(eventToCombo(press(' '))).toBe('Space');
    expect(eventToCombo(press('k'))).toBe('K');
    expect(eventToCombo(press('K'))).toBe('K');
    expect(eventToCombo(press('ArrowLeft'))).toBe('ArrowLeft');
    expect(eventToCombo(press('['))).toBe('[');
  });

  it('writes Shift for letters and named keys, not for symbols that already carry it', () => {
    expect(eventToCombo(press('N', { shiftKey: true }))).toBe('Shift+N');
    expect(eventToCombo(press('ArrowRight', { shiftKey: true }))).toBe('Shift+ArrowRight');
    expect(eventToCombo(press('{', { shiftKey: true }))).toBe('{');
  });

  it('gives nothing for a lone modifier, a dead key or a press with Ctrl, Alt or Meta', () => {
    expect(eventToCombo(press('Shift', { shiftKey: true }))).toBeNull();
    expect(eventToCombo(press('Dead'))).toBeNull();
    expect(eventToCombo(press('k', { ctrlKey: true }))).toBeNull();
    expect(eventToCombo(press('k', { altKey: true }))).toBeNull();
    expect(eventToCombo(press('k', { metaKey: true }))).toBeNull();
  });
});

describe('resolveAction and findConflict', () => {
  it('finds the action of every default combination', () => {
    for (const action of PLAYER_ACTIONS)
      for (const combo of DEFAULT_SHORTCUTS[action]) expect(resolveAction(DEFAULT_SHORTCUTS, combo)).toBe(action);
    expect(resolveAction(DEFAULT_SHORTCUTS, 'Q')).toBeNull();
  });

  it('matches the PRD defaults', () => {
    expect(DEFAULT_SHORTCUTS['play-pause']).toEqual(['Space', 'K']);
    expect(DEFAULT_SHORTCUTS.next).toEqual(['Shift+N']);
    expect(DEFAULT_SHORTCUTS.slower).toEqual(['[']);
  });

  it('reports the other action that owns a combination, never the action itself', () => {
    expect(findConflict(DEFAULT_SHORTCUTS, 'mute', 'F')).toBe('fullscreen');
    expect(findConflict(DEFAULT_SHORTCUTS, 'mute', 'M')).toBeNull();
    expect(findConflict(DEFAULT_SHORTCUTS, 'mute', 'Q')).toBeNull();
  });
});

describe('formatCombo', () => {
  it('prints arrows and spaces out modifiers', () => {
    expect(formatCombo('ArrowLeft')).toBe('←');
    expect(formatCombo('Shift+N')).toBe('Shift N');
    expect(formatCombo('Space')).toBe('Space');
  });
});

describe('shortcutMapSchema', () => {
  it('accepts the defaults and a rebinding', () => {
    expect(shortcutMapSchema.safeParse(DEFAULT_SHORTCUTS).success).toBe(true);
    expect(shortcutMapSchema.safeParse({ ...DEFAULT_SHORTCUTS, mute: ['X'] }).success).toBe(true);
  });

  it('rejects a missing action, an empty list, Escape and a combination bound twice', () => {
    const { mute: _mute, ...missing } = DEFAULT_SHORTCUTS;
    expect(shortcutMapSchema.safeParse(missing).success).toBe(false);
    expect(shortcutMapSchema.safeParse({ ...DEFAULT_SHORTCUTS, mute: [] }).success).toBe(false);
    expect(shortcutMapSchema.safeParse({ ...DEFAULT_SHORTCUTS, mute: ['Escape'] }).success).toBe(false);
    expect(shortcutMapSchema.safeParse({ ...DEFAULT_SHORTCUTS, mute: ['F'] }).success).toBe(false);
  });
});

describe('player settings', () => {
  it('defaults to the standard keys and a five-second countdown', () => {
    expect(DEFAULT_SETTINGS.playerShortcuts).toEqual(DEFAULT_SHORTCUTS);
    expect(DEFAULT_SETTINGS.playerAutoplayCountdown).toBe(5);
  });

  it('falls back to the defaults when an old profile or backup has no such keys', () => {
    const result = settingsFromStored(new Map([['playerAutoplay', 'false']]));
    expect(result.playerShortcuts).toEqual(DEFAULT_SHORTCUTS);
    expect(result.playerAutoplayCountdown).toBe(5);
  });

  it('falls back when the stored value is broken, and keeps a valid one', () => {
    const broken = settingsFromStored(
      new Map([
        ['playerShortcuts', '{"mute":"M"}'],
        ['playerAutoplayCountdown', '7'],
      ]),
    );
    expect(broken.playerShortcuts).toEqual(DEFAULT_SHORTCUTS);
    expect(broken.playerAutoplayCountdown).toBe(5);

    const map = { ...DEFAULT_SHORTCUTS, mute: ['X'] };
    const valid = settingsFromStored(
      new Map([
        ['playerShortcuts', JSON.stringify(map)],
        ['playerAutoplayCountdown', '10'],
      ]),
    );
    expect(valid.playerShortcuts).toEqual(map);
    expect(valid.playerAutoplayCountdown).toBe(10);
  });

  it('validates a patch', () => {
    expect(settingsPatchSchema.safeParse({ playerAutoplayCountdown: 3 }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ playerAutoplayCountdown: 4 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ playerShortcuts: { ...DEFAULT_SHORTCUTS, mute: ['F'] } }).success).toBe(
      false,
    );
  });
});
