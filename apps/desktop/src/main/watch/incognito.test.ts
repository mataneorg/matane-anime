import { describe, expect, it } from 'vitest';
import { IncognitoState } from './incognito';

describe('IncognitoState', () => {
  it('starts off', () => {
    expect(new IncognitoState().enabled).toBe(false);
  });

  it('turns on and off and says what it is now', () => {
    const state = new IncognitoState();
    expect(state.set(true)).toBe(true);
    expect(state.enabled).toBe(true);
    expect(state.set(false)).toBe(false);
    expect(state.enabled).toBe(false);
  });

  it('tells listeners about a change only', () => {
    const state = new IncognitoState();
    const heard: boolean[] = [];
    state.subscribe((on) => heard.push(on));
    state.set(false);
    state.set(true);
    state.set(true);
    state.set(false);
    expect(heard).toEqual([true, false]);
  });

  it('stops telling a listener that unsubscribed', () => {
    const state = new IncognitoState();
    const heard: boolean[] = [];
    const stop = state.subscribe((on) => heard.push(on));
    stop();
    state.set(true);
    expect(heard).toEqual([]);
  });
});
