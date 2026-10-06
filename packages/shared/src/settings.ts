import { z } from 'zod';
import { ACCENTS, LANGUAGES, THEME_MODES } from './theme';

/** App-wide settings. Stored one key per row in the `settings` table (value as JSON). */
export const appSettingsSchema = z.object({
  theme: z.enum(THEME_MODES),
  accent: z.enum(ACCENTS),
  /** Pure black surfaces in the dark flavors. Ignored by Latte. */
  amoled: z.boolean(),
  /** `system` follows the OS locale. */
  language: z.enum(['system', ...LANGUAGES]),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'mocha',
  accent: 'mauve',
  amoled: false,
  language: 'system',
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
