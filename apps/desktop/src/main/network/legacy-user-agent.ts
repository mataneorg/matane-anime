import type { RawSettings } from './proxy-password';

/** Where the global User-Agent lived before it became the `userAgent` setting (phase 3: a raw row, no UI). */
export const LEGACY_USER_AGENT_KEY = 'network.userAgent';

/**
 * Copies the old raw row into the `userAgent` setting once. The setting wins when it already has a value; the old row
 * is emptied either way, so a later reset to "default" is not undone at the next start.
 */
export function migrateLegacyUserAgent(
  raw: RawSettings,
  current: string | null,
  save: (userAgent: string) => void,
): boolean {
  const legacy = raw.getValue<unknown>(LEGACY_USER_AGENT_KEY, null);
  if (legacy === null) return false;
  raw.setValue(LEGACY_USER_AGENT_KEY, null);
  if (current !== null || typeof legacy !== 'string' || !legacy.trim()) return false;
  save(legacy.trim());
  return true;
}
