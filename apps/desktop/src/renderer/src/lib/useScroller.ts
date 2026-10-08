import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * The page (`<main>`) is the scroll container of every long list. A virtualizer needs that element and the
 * distance from its top to the list, which changes as the content above the list loads and wraps.
 */
export function useScroller(list: RefObject<HTMLElement | null>): {
  scroller: HTMLElement | null;
  margin: number;
  width: number;
} {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [margin, setMargin] = useState(0);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = list.current;
    const scrollElement = element?.closest('main') as HTMLElement | null;
    if (!element || !scrollElement) return;
    // A ResizeObserver reports once as soon as it starts watching, so the first measurement arrives here too.
    const measure = (): void => {
      setScroller(scrollElement);
      setMargin(
        element.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop,
      );
      setWidth(element.clientWidth);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scrollElement);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, [list]);

  return { scroller, margin, width };
}
