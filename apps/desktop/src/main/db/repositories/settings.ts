import { type AppSettings, SETTING_KEYS, type SettingsPatch, settingsFromStored } from '@matane-anime/shared';
import { eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { settings } from '../schema';

export class SettingsRepository {
  constructor(private readonly db: AppDatabase) {}

  /** Any JSON value under any key (window geometry and the like). */
  getValue<T>(key: string, fallback: T): T {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    if (!row) return fallback;
    try {
      return JSON.parse(row.valueJson) as T;
    } catch {
      return fallback;
    }
  }

  setValue(key: string, value: unknown): void {
    const valueJson = JSON.stringify(value);
    this.db
      .insert(settings)
      .values({ key, valueJson })
      .onConflictDoUpdate({ target: settings.key, set: { valueJson } })
      .run();
  }

  /** Stored values are validated one by one, so a single corrupt key falls back to its default. */
  getAppSettings(): AppSettings {
    const rows = this.db.select().from(settings).where(inArray(settings.key, SETTING_KEYS)).all();
    return settingsFromStored(new Map(rows.map((row) => [row.key, row.valueJson])));
  }

  updateAppSettings(patch: SettingsPatch): AppSettings {
    this.db.transaction((tx) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const valueJson = JSON.stringify(value);
        tx.insert(settings)
          .values({ key, valueJson })
          .onConflictDoUpdate({ target: settings.key, set: { valueJson } })
          .run();
      }
    });
    return this.getAppSettings();
  }
}
