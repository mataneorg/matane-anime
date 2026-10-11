import type { AvailableExtension, ExtensionInfo, RepoInfo } from '@matane-anime/shared';
import { describe, expect, it } from 'vitest';
import { availableMenu, installedMenu, repoTrustAction } from './menus';

const installed = (extra: Partial<ExtensionInfo> = {}): ExtensionInfo => ({
  id: 'ext',
  key: 'ext',
  folder: null,
  origin: 'repo',
  repoId: 1,
  repoName: 'Repo',
  trust: 'trusted',
  updateAvailable: null,
  shadowed: false,
  status: 'ready',
  error: null,
  name: 'Ext',
  version: '1.0.0',
  nsfw: false,
  hasPreferences: false,
  sources: [],
  ...extra,
});

const offered = (extra: Partial<AvailableExtension> = {}): AvailableExtension => ({
  repoId: 1,
  repoName: 'Repo',
  repoTrust: 'trusted',
  id: 'ext',
  name: 'Ext',
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

const repo = (trust: RepoInfo['trust']): RepoInfo => ({
  id: 1,
  url: 'https://example.test/repo/',
  name: null,
  trust,
  signingKey: null,
  fingerprint: null,
  lastFetchedAt: null,
  lastError: null,
  extensionCount: 0,
});

describe('installedMenu', () => {
  it('offers only the removal for a plain installed extension', () => {
    expect(installedMenu(installed())).toEqual({
      preferences: false,
      update: null,
      reinstall: false,
      reload: false,
      removal: 'uninstall',
    });
  });

  it('offers preferences and the update with its version', () => {
    const menu = installedMenu(installed({ hasPreferences: true, updateAvailable: '1.2.0' }));
    expect(menu.preferences).toBe(true);
    expect(menu.update).toBe('1.2.0');
  });

  it('does not offer an update for a copy a dev folder shadows', () => {
    expect(installedMenu(installed({ updateAvailable: '1.2.0', shadowed: true })).update).toBeNull();
  });

  it('offers a reinstall, and no preferences, for a failed copy that came from a repository', () => {
    const menu = installedMenu(installed({ status: 'error', hasPreferences: true }));
    expect(menu.reinstall).toBe(true);
    expect(menu.preferences).toBe(false);
  });

  it('cannot reinstall a failed copy whose repository is gone', () => {
    expect(installedMenu(installed({ status: 'error', repoId: null })).reinstall).toBe(false);
  });

  it('offers a reload and the removal of the folder for a dev extension', () => {
    const menu = installedMenu(installed({ origin: 'dev', repoId: null, trust: null, folder: '/dev/ext' }));
    expect(menu.reload).toBe(true);
    expect(menu.removal).toBe('removeFolder');
  });

  it('cannot reinstall a failed dev extension', () => {
    expect(installedMenu(installed({ origin: 'dev', repoId: null, status: 'error' })).reinstall).toBe(false);
  });
});

describe('availableMenu', () => {
  it('installs what is not installed yet', () => {
    expect(availableMenu(offered())).toBe('install');
  });

  it('updates what a newer entry replaces', () => {
    expect(availableMenu(offered({ installedVersion: '0.9.0', updateAvailable: true }))).toBe('update');
  });

  it('offers nothing for what is installed, incompatible or taken by another origin', () => {
    expect(availableMenu(offered({ installedVersion: '1.0.0' }))).toBeNull();
    expect(availableMenu(offered({ incompatible: 'api' }))).toBeNull();
    expect(availableMenu(offered({ conflict: { kind: 'dev' } }))).toBeNull();
  });
});

describe('repoTrustAction', () => {
  it('trusts an unverified key, doubts a trusted one and leaves an unsigned repository alone', () => {
    expect(repoTrustAction(repo('unverified'))).toBe('trust');
    expect(repoTrustAction(repo('trusted'))).toBe('stop');
    expect(repoTrustAction(repo('unsigned'))).toBeNull();
  });
});
