import { describe, expect, it } from 'vitest';
import { type KeyTargetLike, shouldIgnoreKey } from './keyboard';

const element = (tagName: string, attrs: Record<string, string> = {}, focusVisible = true): KeyTargetLike => ({
  tagName,
  getAttribute: (name) => attrs[name] ?? null,
  matches: (selector) => selector === ':focus-visible' && focusVisible,
});

describe('shouldIgnoreKey', () => {
  it('leaves every key to a text field, but not the seek bar', () => {
    expect(shouldIgnoreKey(element('INPUT', { type: 'text' }), 'K')).toBe(true);
    expect(shouldIgnoreKey(element('TEXTAREA'), 'Space')).toBe(true);
    expect(shouldIgnoreKey(element('SELECT'), 'ArrowLeft')).toBe(true);
    expect(shouldIgnoreKey({ ...element('DIV'), isContentEditable: true }, 'K')).toBe(true);
    expect(shouldIgnoreKey(element('INPUT', { type: 'range' }), 'Space')).toBe(false);
  });

  it('lets Space and Enter activate a control reached with the keyboard, and only those keys', () => {
    expect(shouldIgnoreKey(element('BUTTON'), 'Space')).toBe(true);
    expect(shouldIgnoreKey(element('BUTTON'), 'Enter')).toBe(true);
    expect(shouldIgnoreKey(element('DIV', { role: 'menuitem' }), 'Space')).toBe(true);
    expect(shouldIgnoreKey(element('BUTTON'), 'K')).toBe(false);
    expect(shouldIgnoreKey(element('BUTTON'), 'ArrowLeft')).toBe(false);
    expect(shouldIgnoreKey(element('BUTTON'), null)).toBe(false);
  });

  it('still pauses on Space when a button only has focus because it was clicked', () => {
    expect(shouldIgnoreKey(element('BUTTON', {}, false), 'Space')).toBe(false);
  });

  it('does not ignore the page itself', () => {
    expect(shouldIgnoreKey(element('BODY'), 'Space')).toBe(false);
    expect(shouldIgnoreKey(null, 'Space')).toBe(false);
  });
});
