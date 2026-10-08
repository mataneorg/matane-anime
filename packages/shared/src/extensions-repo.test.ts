import { describe, expect, it } from 'vitest';
import {
  availableExtensionSchema,
  installPreparationSchema,
  repoInfoSchema,
  repoPreviewSchema,
} from './extensions-repo';

describe('repository contract', () => {
  it('accepts a repository with every trust state and refuses unknown ones', () => {
    const repo = {
      id: 1,
      url: 'https://r.test/',
      name: 'R',
      trust: 'trusted',
      signingKey: 'ed25519:7f3a',
      fingerprint: 'ed25519:7f3a…c91e',
      lastFetchedAt: 1,
      lastError: null,
      extensionCount: 2,
    };
    for (const trust of ['trusted', 'unverified', 'unsigned']) {
      expect(repoInfoSchema.safeParse({ ...repo, trust }).success).toBe(true);
    }
    expect(repoInfoSchema.safeParse({ ...repo, trust: 'invalid' }).success).toBe(false);
  });

  it('previews only repositories that can still be added', () => {
    const preview = { url: 'https://r.test/', name: null, signingKey: null, fingerprint: null, extensionCount: 0 };
    expect(repoPreviewSchema.safeParse({ ...preview, trust: 'unsigned' }).success).toBe(true);
    expect(repoPreviewSchema.safeParse({ ...preview, trust: 'trusted' }).success).toBe(false);
  });

  it('describes a conflict as dev or another repository', () => {
    const entry = {
      repoId: 1,
      repoName: 'R',
      repoTrust: 'unsigned',
      id: 'example',
      name: 'Example',
      version: '1.0.0',
      apiVersion: 1,
      nsfw: false,
      langs: ['en'],
      sources: [{ key: 'en', lang: 'en', name: 'Example (EN)' }],
      size: 100,
      installedVersion: null,
      updateAvailable: false,
      incompatible: null,
    };
    expect(availableExtensionSchema.safeParse({ ...entry, conflict: null }).success).toBe(true);
    expect(availableExtensionSchema.safeParse({ ...entry, conflict: { kind: 'dev' } }).success).toBe(true);
    expect(
      availableExtensionSchema.safeParse({ ...entry, conflict: { kind: 'repo', repoId: 2, repoName: 'Other' } })
        .success,
    ).toBe(true);
    expect(availableExtensionSchema.safeParse({ ...entry, conflict: { kind: 'zip' } }).success).toBe(false);
  });

  it('carries the warnings an install dialog shows', () => {
    const preparation = {
      token: 't',
      repo: { id: 1, name: 'R', trust: 'unverified', fingerprint: 'ed25519:7f3a…c91e' },
      extension: {
        id: 'example',
        name: 'Example',
        version: '1.0.0',
        apiVersion: 1,
        langs: ['en'],
        nsfw: true,
        size: 10,
        sha256: 'a'.repeat(64),
      },
      installedVersion: null,
      warnings: ['unverified', 'nsfw'],
    };
    expect(installPreparationSchema.safeParse(preparation).success).toBe(true);
    expect(installPreparationSchema.safeParse({ ...preparation, warnings: ['spooky'] }).success).toBe(false);
  });
});
