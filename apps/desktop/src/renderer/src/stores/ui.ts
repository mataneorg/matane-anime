import { create } from 'zustand';

const SIDEBAR_KEY = 'matane-anime.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

/** Renderer-only, transient UI state (never data that main owns). */
interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarCollapsed: readCollapsed(),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    set({ sidebarCollapsed: next });
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
    } catch {
      // A per-viewer convenience only; the app works without it.
    }
  },
}));
