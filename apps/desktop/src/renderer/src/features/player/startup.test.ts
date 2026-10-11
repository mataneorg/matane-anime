import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { START_TIMEOUT_MS, watchStart } from './startup';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('watchStart', () => {
  it('reports a stream that has delivered nothing by the deadline', () => {
    const stalled = vi.fn();
    watchStart({ readyState: 0 }, stalled);
    vi.advanceTimersByTime(START_TIMEOUT_MS - 1);
    expect(stalled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stalled).toHaveBeenCalledTimes(1);
  });

  it('leaves a stream alone that has data, even if it is paused', () => {
    const stalled = vi.fn();
    watchStart({ readyState: 2 }, stalled);
    vi.advanceTimersByTime(START_TIMEOUT_MS * 2);
    expect(stalled).not.toHaveBeenCalled();
  });

  it('reads the state at the deadline, not when the watch started', () => {
    const stalled = vi.fn();
    const media = { readyState: 0 };
    watchStart(media, stalled);
    media.readyState = 4;
    vi.advanceTimersByTime(START_TIMEOUT_MS);
    expect(stalled).not.toHaveBeenCalled();
  });

  it('stops when told to', () => {
    const stalled = vi.fn();
    const stop = watchStart({ readyState: 0 }, stalled);
    stop();
    vi.advanceTimersByTime(START_TIMEOUT_MS * 2);
    expect(stalled).not.toHaveBeenCalled();
  });
});
