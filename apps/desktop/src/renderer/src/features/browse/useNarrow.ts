import { useLayoutEffect, useState } from 'react';

/** Whether `node` is narrower than `below` px. Pass the element from a callback ref so it is measured once it exists. */
export function useNarrow(node: HTMLElement | null, below: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    if (!node) return;
    const measure = (): void => setNarrow(node.clientWidth < below);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, below]);
  return narrow;
}
