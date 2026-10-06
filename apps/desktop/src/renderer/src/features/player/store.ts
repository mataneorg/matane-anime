import { create } from 'zustand';

/**
 * Transient player state: position, buffering, which panel is open. It changes many times a second, so it
 * lives here and never in TanStack Query (docs/PRD.md §8.2). Persistent choices (volume, speed, autoplay)
 * are settings, written through `settings.set`.
 */
export interface PlayerError {
  /** Which explanation to show; see `player.error.*` in the locale files. */
  cause: 'expired' | 'network' | 'codec' | 'noStream' | 'generic';
  detail: string;
  tried: string[];
}

interface PlayerState {
  currentTime: number;
  duration: number;
  /** End of the buffered range that contains the playhead. */
  bufferedEnd: number;
  paused: boolean;
  buffering: boolean;
  ended: boolean;
  fullscreen: boolean;
  controlsVisible: boolean;
  panel: 'none' | 'servers' | 'episodes';
  toast: string | null;
  error: PlayerError | null;
  /** Seconds left before the next episode starts by itself; null when not counting down. */
  countdown: number | null;
  set: (patch: Partial<Omit<PlayerState, 'set' | 'reset'>>) => void;
  reset: () => void;
}

const initial = {
  currentTime: 0,
  duration: 0,
  bufferedEnd: 0,
  paused: true,
  buffering: true,
  ended: false,
  fullscreen: false,
  controlsVisible: true,
  panel: 'none' as const,
  toast: null,
  error: null,
  countdown: null,
};

export const usePlayerStore = create<PlayerState>((set) => ({
  ...initial,
  set: (patch) => set(patch),
  reset: () => set({ ...initial }),
}));

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
