import { create } from 'zustand';

/** Whether the command palette is open: the title bar's search button and Ctrl+K both set it. */
interface PaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const usePaletteStore = create<PaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
