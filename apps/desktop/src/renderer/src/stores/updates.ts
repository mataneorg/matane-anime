import type { UpdateStatus } from '@matane-anime/shared';
import { create } from 'zustand';

/** Progress of the running update check, pushed by main (`updates.status`). Transient, so not in Query. */
interface UpdatesState {
  status: UpdateStatus;
  setStatus: (status: UpdateStatus) => void;
}

export const useUpdatesStore = create<UpdatesState>((set) => ({
  status: { checking: false, done: 0, total: 0 },
  setStatus: (status) => set({ status }),
}));
