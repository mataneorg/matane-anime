import type { ChangelogEntry } from '@matane-anime/shared';
import { describe, expect, it } from 'vitest';
import { compareVersions, entriesSince, entryFor, whatsNewDecision } from './version';

const entry = (version: string): ChangelogEntry => ({ version, date: '2026-01-01', items: [version] });

describe('compareVersions', () => {
  it('compares the numbers, not the text', () => {
    expect(compareVersions('0.2.0', '0.10.0')).toBe(-1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('puts a prerelease below its release and orders prereleases', () => {
    expect(compareVersions('0.1.0-beta.1', '0.1.0')).toBe(-1);
    expect(compareVersions('0.1.0-beta.1', '0.1.0-beta.2')).toBe(-1);
    expect(compareVersions('0.1.0-beta.10', '0.1.0-beta.2')).toBe(1);
    expect(compareVersions('0.1.0-alpha', '0.1.0-beta')).toBe(-1);
    expect(compareVersions('0.1.0-beta', '0.1.0-beta.1')).toBe(-1);
    expect(compareVersions('0.1.0-1', '0.1.0-beta')).toBe(-1);
    expect(compareVersions('0.2.0-beta.1', '0.1.9')).toBe(1);
  });

  it('accepts a leading v and ignores build metadata', () => {
    expect(compareVersions('v0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('0.1.0+abc', '0.1.0')).toBe(0);
  });

  it('is null for something that is not a version', () => {
    expect(compareVersions('latest', '0.1.0')).toBeNull();
    expect(compareVersions('0.1.0', '')).toBeNull();
  });
});

describe('entriesSince', () => {
  const entries = ['0.2.0', '0.1.0', '0.1.0-beta.2', '0.1.0-beta.1'].map(entry);

  it('lists what is newer than the last seen version, up to the running one', () => {
    expect(entriesSince(entries, '0.1.0-beta.1', '0.2.0').map((item) => item.version)).toEqual([
      '0.2.0',
      '0.1.0',
      '0.1.0-beta.2',
    ]);
    expect(entriesSince(entries, '0.1.0-beta.2', '0.1.0').map((item) => item.version)).toEqual(['0.1.0']);
  });

  it('leaves out entries for versions that have not been released to this build', () => {
    expect(entriesSince(entries, '0.1.0-beta.1', '0.1.0-beta.2').map((item) => item.version)).toEqual(['0.1.0-beta.2']);
  });
});

describe('whatsNewDecision', () => {
  const entries = [entry('0.2.0'), entry('0.1.0')];
  const base = { onboardingDone: true, lastSeen: '0.1.0', current: '0.2.0', entries };

  it('only remembers the version on a first run', () => {
    expect(whatsNewDecision({ ...base, onboardingDone: false })).toEqual({ kind: 'remember' });
    expect(whatsNewDecision({ ...base, lastSeen: null })).toEqual({ kind: 'remember' });
  });

  it('shows the new entries after an update', () => {
    const decision = whatsNewDecision(base);
    expect(decision.kind).toBe('show');
    expect(decision.kind === 'show' && decision.entries.map((item) => item.version)).toEqual(['0.2.0']);
  });

  it('lists only the running version when several releases were skipped', () => {
    const decision = whatsNewDecision({ ...base, entries: [entry('0.3.0'), entry('0.2.0')], current: '0.3.0' });
    expect(decision.kind === 'show' && decision.entries.map((item) => item.version)).toEqual(['0.3.0']);
  });

  it('only remembers when the changelog has notes for a skipped release but not for the running one', () => {
    expect(whatsNewDecision({ ...base, current: '0.3.0' })).toEqual({ kind: 'remember' });
  });

  it('does nothing when the version did not change', () => {
    expect(whatsNewDecision({ ...base, lastSeen: '0.2.0' })).toEqual({ kind: 'none' });
  });

  it('stays quiet after a downgrade or with an unreadable version', () => {
    expect(whatsNewDecision({ ...base, lastSeen: '0.3.0' })).toEqual({ kind: 'none' });
    expect(whatsNewDecision({ ...base, lastSeen: 'weird' })).toEqual({ kind: 'none' });
  });

  it('remembers the version when the changelog has nothing for the update', () => {
    expect(whatsNewDecision({ ...base, lastSeen: '0.2.0', current: '0.2.1' })).toEqual({ kind: 'remember' });
    expect(whatsNewDecision({ ...base, entries: [] })).toEqual({ kind: 'remember' });
  });
});

describe('entryFor', () => {
  it('finds the entry of exactly that version', () => {
    const entries = [entry('0.2.0'), entry('0.1.0')];
    expect(entryFor(entries, '0.1.0')?.version).toBe('0.1.0');
    expect(entryFor(entries, 'v0.2.0')?.version).toBe('0.2.0');
    expect(entryFor(entries, '0.3.0')).toBeNull();
  });
});
