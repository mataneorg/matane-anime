import { useCallback, useState } from 'react';

/** A per-viewer convenience (last sort, last tab). Reads and writes never throw: the app works without it. */
export function usePersistedState<T extends string>(
  key: string,
  initial: T,
  allowed: readonly T[],
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key) as T | null;
      return stored !== null && allowed.includes(stored) ? stored : initial;
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // Not worth failing for.
      }
    },
    [key],
  );
  return [value, update];
}
