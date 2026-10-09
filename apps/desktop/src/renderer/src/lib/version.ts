import type { ChangelogEntry } from '@matane-anime/shared';

/** The project's home. */
export const REPOSITORY_URL = 'https://github.com/mataneorg/matane-anime';

/** Where the release notes live. Same address as `RELEASES_URL` in main/app/updater.ts (the renderer cannot import main). */
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;

interface ParsedVersion {
  core: [number, number, number];
  /** Dot-separated identifiers after the `-`; empty for a final release. */
  pre: string[];
}

function parse(version: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  };
}

/** Semver precedence for one prerelease identifier: numbers by value, and below words; words by their text. */
function compareIdentifier(a: string, b: string): number {
  const aNumber = /^\d+$/.test(a);
  const bNumber = /^\d+$/.test(b);
  if (aNumber && bNumber) return Math.sign(Number(a) - Number(b));
  if (aNumber) return -1;
  if (bNumber) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Negative when `a` is older than `b`, positive when newer, 0 when equal; semver rules, so `0.1.0-beta.2` is
 * older than `0.1.0` and newer than `0.1.0-beta.1`. Returns `null` when either is not a version (build metadata
 * after `+` is ignored).
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index++) {
    const difference = (left.core[index] as number) - (right.core[index] as number);
    if (difference !== 0) return Math.sign(difference);
  }
  // A final release is newer than any prerelease of the same version.
  if (left.pre.length === 0 || right.pre.length === 0) return Math.sign(right.pre.length - left.pre.length);
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index++) {
    const x = left.pre[index];
    const y = right.pre[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const result = compareIdentifier(x, y);
    if (result !== 0) return result;
  }
  return 0;
}

/** The changelog entry of exactly this version, or null when the release has none. */
export function entryFor(entries: readonly ChangelogEntry[], version: string): ChangelogEntry | null {
  return entries.find((entry) => compareVersions(entry.version, version) === 0) ?? null;
}

/** The entries to show: newer than the version last seen, and not newer than the one running. Newest first, as given. */
export function entriesSince(entries: readonly ChangelogEntry[], lastSeen: string, current: string): ChangelogEntry[] {
  return entries.filter((entry) => {
    const afterSeen = compareVersions(entry.version, lastSeen);
    const upToCurrent = compareVersions(entry.version, current);
    return afterSeen !== null && upToCurrent !== null && afterSeen > 0 && upToCurrent <= 0;
  });
}

export type WhatsNewDecision =
  /** Show these entries. */
  | { kind: 'show'; entries: ChangelogEntry[] }
  /** Nothing to show, but remember the running version. */
  | { kind: 'remember' }
  | { kind: 'none' };

/**
 * What the app does about "What's new" at start (UI-10). A first run (onboarding not done, or no version stored)
 * only remembers the version. An update shows the notes of the running version; if the changelog has none for it,
 * it still remembers the version so the check is not repeated.
 */
export function whatsNewDecision(input: {
  onboardingDone: boolean;
  lastSeen: string | null;
  current: string;
  entries: readonly ChangelogEntry[];
}): WhatsNewDecision {
  const { onboardingDone, lastSeen, current, entries } = input;
  if (!onboardingDone || lastSeen === null) return { kind: 'remember' };
  if (lastSeen === current) return { kind: 'none' };
  const order = compareVersions(current, lastSeen);
  // A downgrade, or a version we cannot read: keep what is stored and stay quiet.
  if (order === null || order <= 0) return { kind: 'none' };
  // Only the running version is listed, even when several releases were skipped.
  const running = entryFor(entriesSince(entries, lastSeen, current), current);
  return running ? { kind: 'show', entries: [running] } : { kind: 'remember' };
}
