import type { DownloadProgress } from '@matane-anime/shared';
import { create } from 'zustand';
import { mergeProgress } from '@renderer/features/downloads/progress';

/**
 * What changes several times a second while downloads run (fed by the `downloads.progress` event), and the
 * size-limit question waiting for an answer. The list itself is a TanStack Query (`['downloads']`).
 */
interface DownloadsState {
  progress: Record<number, DownloadProgress>;
  receive: (batch: DownloadProgress[]) => void;
  /** Episodes a manual download was refused for passing the size limit; set while the user is asked (DL-10). */
  limitPrompt: number[] | null;
  askLimit: (episodeIds: number[]) => void;
  dismissLimit: () => void;
}

export const useDownloadsStore = create<DownloadsState>((set) => ({
  progress: {},
  receive: (batch) => set((state) => ({ progress: mergeProgress(state.progress, batch) })),
  limitPrompt: null,
  askLimit: (episodeIds) => set({ limitPrompt: episodeIds }),
  dismissLimit: () => set({ limitPrompt: null }),
}));
