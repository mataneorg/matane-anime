// The first-run flow (docs/PRD.md UI-9) is for new profiles only. A profile that already holds anime in the
// library or a history entry was made before the flow existed, so it counts as done and never sees it.

const KEY = 'onboardingDone';

interface SettingsStore {
  getValue<T>(key: string, fallback: T): T;
  setValue(key: string, value: unknown): void;
}

/**
 * Writes `onboardingDone: true` once for an existing profile. Does nothing when the setting was ever stored
 * (done or not), and does not look at the data at all in that case: the counts are only asked for when needed.
 * Returns whether it wrote.
 */
export function markExistingProfileOnboarded(settings: SettingsStore, hasData: () => boolean): boolean {
  if (settings.getValue<boolean | null>(KEY, null) !== null) return false;
  if (!hasData()) return false;
  settings.setValue(KEY, true);
  return true;
}
