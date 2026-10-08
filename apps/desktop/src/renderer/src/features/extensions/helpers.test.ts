import type { AvailableExtension, ExtensionInfo, RepoInfo } from '@matane-anime/shared';
import { describe, expect, it } from 'vitest';
import {
  alsoOfferedBy,
  availableState,
  countUpdates,
  formatSize,
  languageCodes,
  languageName,
  languageOptions,
  shortHash,
  sortAvailable,
  sortInstalled,
  sortRepos,
  toggleLanguage,
  trustView,
} from './helpers';

const installed = (id: string, extra: Partial<ExtensionInfo> = {}): ExtensionInfo => ({
  id,
  key: id,
  folder: null,
  origin: 'repo',
  repoId: 1,
  repoName: 'Repo',
  trust: 'trusted',
  updateAvailable: null,
  shadowed: false,
  status: 'ready',
  error: null,
  name: id,
  version: '1.0.0',
  nsfw: false,
  hasPreferences: false,
  sources: [{ id: `${id}/en`, key: 'en', lang: 'en', name: id }],
  ...extra,
});

const offered = (id: string, extra: Partial<AvailableExtension> = {}): AvailableExtension => ({
  repoId: 1,
  repoName: 'Repo',
  repoTrust: 'trusted',
  id,
  name: id,
  version: '1.0.0',
  apiVersion: 1,
  nsfw: false,
  langs: ['en'],
  sources: [],
  size: 1024,
  installedVersion: null,
  updateAvailable: false,
  incompatible: null,
  conflict: null,
  ...extra,
});

describe('trustView', () => {
  it('shows a trusted key calmly and everything else as a warning', () => {
    expect(trustView('trusted')).toEqual({ label: 'trusted', tone: 'ok' });
    expect(trustView('unverified')).toEqual({ label: 'unverified', tone: 'warn' });
    expect(trustView('unsigned')).toEqual({ label: 'unsigned', tone: 'warn' });
  });
  it('labels a dev folder as such', () => {
    expect(trustView(null).label).toBe('dev');
  });
});

describe('formatSize', () => {
  it('uses bytes, KB and MB', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(38 * 1024)).toBe('38 KB');
    expect(formatSize(100)).toBe('100 B');
    expect(formatSize(1100)).toBe('1 KB');
    expect(formatSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
});

describe('shortHash', () => {
  it('keeps both ends of a digest', () => {
    const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(shortHash(hash)).toBe('e3b0c442…b855');
    expect(shortHash('abc')).toBe('abc');
  });
});

describe('languages', () => {
  it('names a language in the app language and falls back to the code', () => {
    expect(languageName('en', 'en')).toBe('English');
    expect(languageName('id', 'en')).toBe('Indonesian');
    expect(languageName('multi', 'en')).toBe('multi');
    expect(languageName('not a code!', 'en')).toBe('not a code!');
  });
  it('lists the codes of sources once, upper-cased', () => {
    expect(languageCodes([{ lang: 'en' }, { lang: 'id' }, { lang: 'en' }])).toBe('EN, ID');
  });
  it('offers the usual languages first, then what sources use and what is selected', () => {
    expect(languageOptions([], [])).toEqual(['en', 'id', 'ja', 'es']);
    expect(languageOptions(['fr', 'id', 'multi', 'de'], ['pt'])).toEqual(['en', 'id', 'ja', 'es', 'de', 'fr', 'pt']);
  });
  it('toggles a chip; none selected means all', () => {
    expect(toggleLanguage([], 'en')).toEqual(['en']);
    expect(toggleLanguage(['en', 'id'], 'en')).toEqual(['id']);
    expect(toggleLanguage(['en'], 'en')).toEqual([]);
  });
});

describe('installed extensions', () => {
  it('puts updates first, then failures, then orders by name', () => {
    const sorted = sortInstalled([
      installed('zeta'),
      installed('broken', { status: 'error' }),
      installed('alpha'),
      installed('mid', { updateAvailable: '2.0.0' }),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(['mid', 'broken', 'alpha', 'zeta']);
  });
  it('counts updates, not those a dev folder shadows', () => {
    expect(
      countUpdates([
        installed('a', { updateAvailable: '1.1.0' }),
        installed('b', { updateAvailable: '1.1.0', shadowed: true }),
        installed('c'),
      ]),
    ).toBe(1);
  });
  it('names the other repositories that offer the same id', () => {
    const extension = installed('a');
    const entries = [
      offered('a', { repoId: 1, repoName: 'Repo' }),
      offered('a', { repoId: 2, repoName: 'Demo Repo' }),
      offered('a', { repoId: 3, repoName: 'Demo Repo' }),
      offered('b', { repoId: 2, repoName: 'Other' }),
    ];
    expect(alsoOfferedBy(extension, entries)).toEqual(['Demo Repo']);
  });
});

describe('available extensions', () => {
  it('says what the button does', () => {
    expect(availableState(offered('a'))).toEqual({ kind: 'install' });
    expect(availableState(offered('a', { installedVersion: '1.0.0' }))).toEqual({ kind: 'installed' });
    expect(availableState(offered('a', { installedVersion: '0.9.0', updateAvailable: true }))).toEqual({
      kind: 'update',
    });
  });
  it('explains an entry that cannot be installed', () => {
    expect(availableState(offered('a', { incompatible: 'api' }))).toEqual({ kind: 'incompatible', reason: 'api' });
    expect(availableState(offered('a', { conflict: { kind: 'dev' } }))).toEqual({
      kind: 'conflict',
      with: { kind: 'dev' },
    });
    expect(availableState(offered('a', { conflict: { kind: 'repo', repoId: 2, repoName: 'Demo Repo' } }))).toEqual({
      kind: 'conflict',
      with: { kind: 'repo', name: 'Demo Repo' },
    });
  });
  it('lets an incompatibility win over a conflict', () => {
    expect(availableState(offered('a', { incompatible: 'app', conflict: { kind: 'dev' } }))).toEqual({
      kind: 'incompatible',
      reason: 'app',
    });
  });
  it('orders updates first, then by name', () => {
    const sorted = sortAvailable([
      offered('b', { name: 'Beta' }),
      offered('c', { name: 'Gamma', updateAvailable: true }),
      offered('a', { name: 'Alpha' }),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('sortRepos', () => {
  const repo = (id: number, name: string | null, lastError: string | null = null): RepoInfo => ({
    id,
    url: `https://r${id}.example/`,
    name,
    trust: 'trusted',
    signingKey: null,
    fingerprint: null,
    lastFetchedAt: null,
    lastError,
    extensionCount: 0,
  });
  it('shows a failing repository first, then by name (or address)', () => {
    const sorted = sortRepos([repo(1, 'Zed'), repo(2, null), repo(3, 'Alpha'), repo(4, 'Mid', 'boom')]);
    expect(sorted.map((r) => r.id)).toEqual([4, 3, 2, 1]);
  });
});
