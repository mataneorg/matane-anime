import { z } from 'zod';
import { ACCENTS, LANGUAGES, THEME_MODES } from './theme';
import {
  DEFAULT_BROWSE_SETTINGS,
  DEFAULT_GLOBAL_SEARCH_SETTINGS,
  DEFAULT_LIBRARY_SETTINGS,
  browseSettingsSchema,
  globalSearchSettingsSchema,
  librarySettingsSchema,
} from './view-settings';

export const PLAYER_QUALITIES = ['highest', '1080', '720', '480', '360'] as const;
export type PlayerQuality = (typeof PLAYER_QUALITIES)[number];

/** Hours between update checks; 0 turns the schedule off (UPD-1). 168 is weekly. */
export const UPDATE_INTERVALS = [0, 6, 12, 24, 48, 168] as const;
export type UpdateInterval = (typeof UPDATE_INTERVALS)[number];

/** `playback` downloads the quality the player would pick (DL-3); the others pick the nearest height. */
export const DOWNLOAD_QUALITIES = ['playback', ...PLAYER_QUALITIES] as const;
export type DownloadQuality = (typeof DOWNLOAD_QUALITIES)[number];

export const UPDATE_CHANNELS = ['stable', 'beta'] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

/** DNS over HTTPS (docs/PRD.md NET-6): `auto` tries it first and falls back to the system resolver (Chromium's automatic mode), `always` uses nothing else. */
export const DOH_MODES = ['off', 'auto', 'always'] as const;
export type DohMode = (typeof DOH_MODES)[number];

/** The presets; `custom` uses `dohCustomUrl`. The URLs live in main (`network/config.ts`). */
export const DOH_PROVIDERS = ['cloudflare', 'google', 'quad9', 'adguard', 'custom'] as const;
export type DohProvider = (typeof DOH_PROVIDERS)[number];

export const PROXY_MODES = ['system', 'none', 'http', 'socks5'] as const;
export type ProxyMode = (typeof PROXY_MODES)[number];

/** App-wide settings. Stored one key per row in the `settings` table (value as JSON). */
export const appSettingsSchema = z.object({
  theme: z.enum(THEME_MODES),
  accent: z.enum(ACCENTS),
  /** Pure black surfaces in the dark flavors. Ignored by Latte. */
  amoled: z.boolean(),
  /** `system` follows the OS locale. */
  language: z.enum(['system', ...LANGUAGES]),
  /** 18+ sources are hidden unless this is on (docs/PRD.md EXT-15). */
  showNsfw: z.boolean(),
  /** Play the next episode after a 5 s countdown (docs/PRD.md PLY-4). */
  playerAutoplay: z.boolean(),
  /** Which quality to start with (STR-1): the highest, or the nearest to a fixed height. */
  playerQuality: z.enum(PLAYER_QUALITIES),
  /** Arrow keys seek this many seconds; J and L seek twice as many. */
  playerSeekSeconds: z.number().int().min(1).max(60),
  playerVolume: z.number().min(0).max(1),
  playerMuted: z.boolean(),
  playerSpeed: z.number().min(0.5).max(2),
  /** Percent of the video after which an episode counts as watched; 100 means only when it ends (PRG-3). */
  playerWatchedThreshold: z.number().int().min(50).max(100),
  /** Where episodes are saved; null means `Documents/Matane Anime` (DL-6). */
  downloadFolder: z.string().nullable(),
  downloadQuality: z.enum(DOWNLOAD_QUALITIES),
  /** Episodes downloaded at once (DL-1). */
  downloadParallelEpisodes: z.number().int().min(1).max(3),
  /** Segments fetched at once for one HLS episode (DL-1). */
  downloadParallelSegments: z.number().int().min(1).max(16),
  /** Total size of downloaded episodes, in GB, after which auto-download stops (DL-10). */
  downloadSizeLimitGb: z.number().min(1).max(10_000),
  /** Disk budget of the cover cache, in MB; the least recently used covers go first (PRD §15.2). */
  imageCacheSizeMb: z.number().int().min(100).max(51_200),
  /** While watching, download the next episodes (DL-12). */
  downloadAhead: z.boolean(),
  downloadAheadCount: z.number().int().min(1).max(10),
  /** Delete an episode once it is watched, after this many more episodes are watched (DL-13). */
  deleteAfterWatched: z.boolean(),
  deleteAfterWatchedDelay: z.number().int().min(0).max(20),
  /** Categories whose anime keep their downloads after watching. */
  deleteAfterWatchedExcludedCategories: z.array(z.number().int()),
  /** Hours between scheduled update checks (UPD-1). */
  updateIntervalHours: z.union([
    z.literal(0),
    z.literal(6),
    z.literal(12),
    z.literal(24),
    z.literal(48),
    z.literal(168),
  ]),
  /** Library and category checks skip completed anime (UPD-3). */
  updateSkipCompleted: z.boolean(),
  /** ...and anime nothing was watched of. */
  updateSkipNotStarted: z.boolean(),
  /** ...and anime with more than this many unwatched episodes; null turns the rule off. */
  updateSkipUnwatchedOver: z.number().int().min(1).max(1000).nullable(),
  /** Download new episodes after a check, for the categories that allow it (DL-11). */
  autoDownload: z.boolean(),
  /** Keep running in the tray after the window closes (UPD-9). */
  closeToTray: z.boolean(),
  /** Start with the computer, hidden, so checks and downloads keep going (UPD-9). */
  runAtLogin: z.boolean(),
  /** Which GitHub release channel the app updates from. */
  updateChannel: z.enum(UPDATE_CHANNELS),
  /** Languages of the sources to offer (EXT-15); empty means every language. `multi` sources always pass. */
  contentLanguages: z.array(z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/)),
  /** Shows the developer tools: loading an extension from a folder and the extended log (EXT-10). */
  devMode: z.boolean(),
  /** DNS over HTTPS for every request the app makes (NET-6). */
  dohMode: z.enum(DOH_MODES),
  dohProvider: z.enum(DOH_PROVIDERS),
  /** Used when `dohProvider` is `custom`; must be an https URL (checked in main). */
  dohCustomUrl: z.string().max(2048),
  proxyMode: z.enum(PROXY_MODES),
  proxyHost: z.string().max(255),
  proxyPort: z.number().int().min(1).max(65535).nullable(),
  proxyUser: z.string().max(255),
  // The proxy password is not a setting: it stays in main (`network.setProxyPassword`).
  /** Replaces the default User-Agent for every extension that does not set its own (NET-4); null keeps the default. */
  userAgent: z.string().max(512).nullable(),
  /** How the library looks and what narrows it (display, cover size, sort, filters). */
  library: librarySettingsSchema,
  /** How a source's list in Browse looks. */
  browse: browseSettingsSchema,
  /** Global search: the sources asked and whether empty ones are hidden. */
  globalSearch: globalSearchSettingsSchema,
  /** The first-run flow has been completed or skipped (UI-9). */
  onboardingDone: z.boolean(),
  /** The app version whose "What's new" the user has seen; null on a fresh install (UI-10). */
  lastSeenVersion: z.string().max(64).nullable(),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'mocha',
  accent: 'mauve',
  amoled: false,
  language: 'system',
  showNsfw: false,
  playerAutoplay: true,
  playerQuality: 'highest',
  playerSeekSeconds: 5,
  playerVolume: 1,
  playerMuted: false,
  playerSpeed: 1,
  playerWatchedThreshold: 85,
  downloadFolder: null,
  downloadQuality: 'playback',
  downloadParallelEpisodes: 1,
  downloadParallelSegments: 6,
  downloadSizeLimitGb: 20,
  imageCacheSizeMb: 1024,
  downloadAhead: false,
  downloadAheadCount: 2,
  deleteAfterWatched: false,
  deleteAfterWatchedDelay: 1,
  deleteAfterWatchedExcludedCategories: [],
  updateIntervalHours: 12,
  updateSkipCompleted: true,
  updateSkipNotStarted: false,
  updateSkipUnwatchedOver: 10,
  autoDownload: false,
  closeToTray: false,
  runAtLogin: false,
  updateChannel: 'beta',
  contentLanguages: [],
  devMode: false,
  dohMode: 'off',
  dohProvider: 'cloudflare',
  dohCustomUrl: '',
  proxyMode: 'system',
  proxyHost: '',
  proxyPort: null,
  proxyUser: '',
  userAgent: null,
  library: DEFAULT_LIBRARY_SETTINGS,
  browse: DEFAULT_BROWSE_SETTINGS,
  globalSearch: DEFAULT_GLOBAL_SEARCH_SETTINGS,
  onboardingDone: false,
  lastSeenVersion: null,
};

/** A change to some settings. No defaults here: a patch must never overwrite what it does not name. */
export const settingsPatchSchema = appSettingsSchema.partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[];

/**
 * Builds the settings from stored `key -> JSON text` pairs. A missing, unreadable or invalid value
 * falls back to its default, so an old or edited database never stops the app from starting.
 */
export function settingsFromStored(stored: ReadonlyMap<string, string>): AppSettings {
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of SETTING_KEYS) {
    const raw = stored.get(key);
    if (raw === undefined) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    const parsed = appSettingsSchema.shape[key].safeParse(value);
    if (parsed.success) result[key] = parsed.data;
  }
  return result as AppSettings;
}

/** The last window geometry, kept under the `window.state` key (not part of `AppSettings`). */
export const windowStateSchema = z.object({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  maximized: z.boolean(),
});
export type WindowState = z.infer<typeof windowStateSchema>;

export const DEFAULT_WINDOW_STATE: WindowState = { width: 1280, height: 800, maximized: false };
export const WINDOW_STATE_KEY = 'window.state';
