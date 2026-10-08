import { RepoError } from './errors';

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const SEMVER_PATTERN = SEMVER;

export function isSemver(text: string): boolean {
  return SEMVER.test(text);
}

interface Parsed {
  core: [bigint, bigint, bigint];
  pre: string[];
}

function parse(version: string): Parsed {
  const match = SEMVER.exec(version);
  if (!match) throw new RepoError('bad_version', `"${version.slice(0, 40)}" is not a semantic version.`);
  return {
    core: [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)],
    pre: match[4] ? match[4].split('.') : [],
  };
}

function compareBig(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Semver precedence (build metadata ignored); returns -1, 0 or 1. Throws `bad_version` on invalid input. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    const c = compareBig(left.core[i]!, right.core[i]!);
    if (c !== 0) return c as -1 | 1;
  }
  // A version without a prerelease is higher than the same core with one.
  if (left.pre.length === 0 && right.pre.length === 0) return 0;
  if (left.pre.length === 0) return 1;
  if (right.pre.length === 0) return -1;
  const length = Math.min(left.pre.length, right.pre.length);
  for (let i = 0; i < length; i++) {
    const x = left.pre[i]!;
    const y = right.pre[i]!;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return compareBig(BigInt(x), BigInt(y)) as -1 | 1;
    if (xNumeric) return -1;
    if (yNumeric) return 1;
    return x < y ? -1 : 1;
  }
  return left.pre.length === right.pre.length ? 0 : left.pre.length < right.pre.length ? -1 : 1;
}

/** True when `a` has a strictly higher precedence than `b`. */
export function isNewer(a: string, b: string): boolean {
  return compareVersions(a, b) > 0;
}

/** An entry without `minAppVersion` runs on any app. Prereleases of the app sort below the release (semver). */
export function satisfiesMinAppVersion(minAppVersion: string | undefined, appVersion: string): boolean {
  return minAppVersion === undefined || compareVersions(appVersion, minAppVersion) >= 0;
}
