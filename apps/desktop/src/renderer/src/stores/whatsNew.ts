import { create } from 'zustand';

interface WhatsNewState {
  /** Settings → About asked to see the notes of the running version again. */
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useWhatsNewStore = create<WhatsNewState>((set) => ({ open: false, setOpen: (open) => set({ open }) }));
