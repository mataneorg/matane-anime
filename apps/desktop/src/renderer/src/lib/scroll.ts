import { useRouterState } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef } from 'react';

// One position per history entry (not per URL), so Back restores where the user left, while a fresh visit starts at the top.
const positions = new Map<string, number>();
const MAX_ENTRIES = 100;
// The restored content (virtualised rows, lazy images) may need a few frames before it is tall enough to scroll that far.
const MAX_ATTEMPTS = 45;

/** Scrolls an element; a plain function so hooks do not mutate the element they were handed. */
const scrollTo = (target: HTMLElement, top: number): void => {
  target.scrollTop = top;
};

/** The app's scroller: every page scrolls inside the shell's `<main>`. */
const pageScroller = (): HTMLElement | null => document.querySelector('main');

/**
 * Keeps the page's scroll position per history entry: leaving a list for an anime and coming back lands on the same
 * spot. `ready` says the content is rendered (restoring earlier would be clamped to a short page). Pass `element` for
 * a scroller other than `<main>`.
 */
export function useScrollRestoration(ready: boolean, element?: HTMLElement | null): void {
  const key = useRouterState({ select: (state) => state.location.state.__TSR_key ?? state.location.href });
  const restoring = useRef(false);
  const restoredFor = useRef<string | null>(null);

  useEffect(() => {
    const scroller = element ?? pageScroller();
    if (!scroller) return;
    const onScroll = (): void => {
      if (restoring.current) return;
      positions.delete(key);
      positions.set(key, scroller.scrollTop);
      const oldest = positions.keys().next().value;
      if (positions.size > MAX_ENTRIES && oldest !== undefined) positions.delete(oldest);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [element, key]);

  useLayoutEffect(() => {
    const scroller = element ?? pageScroller();
    if (!scroller || !ready || restoredFor.current === key) return;
    restoredFor.current = key;
    const target = positions.get(key) ?? 0;
    if (target === 0) {
      // A new entry starts at the top even though the shell's `<main>` outlives the page.
      scrollTo(scroller, 0);
      return;
    }
    restoring.current = true;
    let frame = 0;
    let attempts = 0;
    const apply = (): void => {
      scrollTo(scroller, target);
      attempts += 1;
      if (Math.abs(scroller.scrollTop - target) < 1 || attempts >= MAX_ATTEMPTS) {
        restoring.current = false;
        return;
      }
      frame = requestAnimationFrame(apply);
    };
    apply();
    return () => {
      cancelAnimationFrame(frame);
      restoring.current = false;
    };
  }, [element, ready, key]);
}
