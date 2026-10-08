import { describe, expect, it } from 'vitest';
import { RepoError } from './errors';
import { compareVersions, isNewer, isSemver, satisfiesMinAppVersion } from './versions';

describe('compareVersions', () => {
  it('orders the numeric core numerically, not lexically', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('10.0.0', '9.0.0')).toBe(1);
  });

  it('follows the semver.org prerelease example chain', () => {
    const chain = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];
    for (let i = 0; i < chain.length; i++) {
      for (let j = 0; j < chain.length; j++) {
        expect(compareVersions(chain[i]!, chain[j]!)).toBe(Math.sign(i - j));
      }
    }
  });

  it('compares numeric identifiers below alphanumeric ones and handles big numbers', () => {
    expect(compareVersions('1.0.0-1', '1.0.0-a')).toBe(-1);
    expect(compareVersions('1.0.0-a-b', '1.0.0-a')).toBe(1);
    expect(compareVersions('1.0.0-alpha.9007199254740993', '1.0.0-alpha.9007199254740992')).toBe(1);
    expect(compareVersions('1.0.99999999999999999999', '1.0.99999999999999999998')).toBe(1);
  });

  it('ignores build metadata', () => {
    expect(compareVersions('1.0.0+a', '1.0.0+b')).toBe(0);
    expect(compareVersions('1.0.0+zzz', '1.0.1')).toBe(-1);
    expect(compareVersions('1.0.0-rc.1+build', '1.0.0-rc.1')).toBe(0);
  });

  it.each(['', '1', '1.0', '1.0.0.0', 'v1.0.0', '01.0.0', '1.0.0-', '1.0.0-01', '1.0.0-a..b', '1.0.x', ' 1.0.0'])(
    'throws bad_version for %j',
    (text) => {
      expect(isSemver(text)).toBe(false);
      expect(() => compareVersions(text, '1.0.0')).toThrow(RepoError);
      expect(() => compareVersions('1.0.0', text)).toThrow(RepoError);
    },
  );
});

describe('isNewer / satisfiesMinAppVersion', () => {
  it('is strict', () => {
    expect(isNewer('1.0.1', '1.0.0')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('1.0.0-rc.1', '1.0.0')).toBe(false);
  });

  it('accepts a missing minimum and compares otherwise', () => {
    expect(satisfiesMinAppVersion(undefined, '0.0.1')).toBe(true);
    expect(satisfiesMinAppVersion('0.2.0', '0.2.0')).toBe(true);
    expect(satisfiesMinAppVersion('0.2.0', '0.10.0')).toBe(true);
    expect(satisfiesMinAppVersion('0.2.0', '0.1.9')).toBe(false);
    expect(satisfiesMinAppVersion('0.2.0', '0.2.0-beta.1')).toBe(false);
  });
});
