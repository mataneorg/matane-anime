import { describe, expect, it } from 'vitest';
import { markExistingProfileOnboarded } from './onboarding';

function store(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getValue: <T>(key: string, fallback: T): T => (values.has(key) ? (values.get(key) as T) : fallback),
    setValue: (key: string, value: unknown): void => void values.set(key, value),
  };
}

describe('markExistingProfileOnboarded', () => {
  it('marks a profile that already has data as done', () => {
    const settings = store();
    expect(markExistingProfileOnboarded(settings, () => true)).toBe(true);
    expect(settings.values.get('onboardingDone')).toBe(true);
  });

  it('leaves a new, empty profile alone so the flow shows', () => {
    const settings = store();
    expect(markExistingProfileOnboarded(settings, () => false)).toBe(false);
    expect(settings.values.has('onboardingDone')).toBe(false);
  });

  it('does not touch a setting that was stored, and does not read the data for it', () => {
    let asked = false;
    const hasData = (): boolean => (asked = true);
    const settings = store({ onboardingDone: false });
    expect(markExistingProfileOnboarded(settings, hasData)).toBe(false);
    expect(settings.values.get('onboardingDone')).toBe(false);
    expect(asked).toBe(false);
  });
});
