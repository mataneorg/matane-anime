import { useEffect } from 'react';
import { create } from 'zustand';

interface CrumbState {
  /** Breadcrumb labels a page adds after the ones its route gives (the source's name, an anime's title). */
  labels: string[];
  set: (labels: string[]) => void;
}

export const useCrumbStore = create<CrumbState>((set) => ({
  labels: [],
  set: (labels) => set({ labels }),
}));

/** Shows `labels` in the title bar after the route's own crumbs while the calling page is mounted. */
export function usePageCrumbs(...labels: (string | undefined)[]): void {
  const key = JSON.stringify(labels);
  useEffect(() => {
    const clean = (JSON.parse(key) as (string | null)[]).filter((label): label is string => Boolean(label));
    useCrumbStore.getState().set(clean);
    return () => useCrumbStore.getState().set([]);
  }, [key]);
}
