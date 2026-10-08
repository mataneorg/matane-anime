import { z } from 'zod';
import { extensionSourceSchema } from './catalog';

// Extension repositories and installing from them as they cross IPC (docs/PRD.md EXT-5…EXT-9).

/**
 * How much the app trusts a repository (EXT-6):
 * - `trusted`: signed with the key the user chose to trust;
 * - `unverified`: signed, but with a key nobody trusted yet;
 * - `unsigned`: no signature at all.
 */
export const repoTrustSchema = z.enum(['trusted', 'unverified', 'unsigned']);
export type RepoTrust = z.infer<typeof repoTrustSchema>;

export const repoInfoSchema = z.object({
  id: z.number().int(),
  /** Base URL, ending in "/". */
  url: z.string(),
  name: z.string().nullable(),
  trust: repoTrustSchema,
  /** The key the repository signs with, as announced (`ed25519:<hex>`), trusted or not. */
  signingKey: z.string().nullable(),
  /** `ed25519:7f3a…c91e`, for display. */
  fingerprint: z.string().nullable(),
  lastFetchedAt: z.number().nullable(),
  /** Why the last refresh failed (a rollback, a key that changed, a broken index, the network). */
  lastError: z.string().nullable(),
  extensionCount: z.number().int(),
});
export type RepoInfo = z.infer<typeof repoInfoSchema>;

/** What the user is shown before a repository is added: nothing is stored yet. */
export const repoPreviewSchema = z.object({
  url: z.string(),
  name: z.string().nullable(),
  trust: z.enum(['unverified', 'unsigned']),
  signingKey: z.string().nullable(),
  fingerprint: z.string().nullable(),
  extensionCount: z.number().int(),
});
export type RepoPreview = z.infer<typeof repoPreviewSchema>;

/** Why an entry of a repository cannot be installed here. */
export const incompatibilitySchema = z.enum(['api', 'app']);

/** Where an id is already taken from (EXT-9): one id comes from one origin at a time. */
export const installConflictSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dev') }),
  z.object({ kind: z.literal('repo'), repoId: z.number().int().nullable(), repoName: z.string().nullable() }),
]);

export const availableExtensionSchema = z.object({
  repoId: z.number().int(),
  repoName: z.string().nullable(),
  repoTrust: repoTrustSchema,
  id: z.string(),
  name: z.string(),
  version: z.string(),
  apiVersion: z.number().int(),
  nsfw: z.boolean(),
  langs: z.array(z.string()),
  sources: z.array(extensionSourceSchema.omit({ id: true })),
  size: z.number().int(),
  /** The installed version of this id, whatever its origin. */
  installedVersion: z.string().nullable(),
  /** The installed copy comes from this repository and this entry is newer. */
  updateAvailable: z.boolean(),
  incompatible: incompatibilitySchema.nullable(),
  /** Set when the id is installed from somewhere else: installing is refused until that one is removed. */
  conflict: installConflictSchema.nullable(),
});
export type AvailableExtension = z.infer<typeof availableExtensionSchema>;

export const installWarningSchema = z.enum(['unverified', 'unsigned', 'nsfw']);

/** The first step of an install (EXT-8): everything the dialog shows, and a token for the second step. */
export const installPreparationSchema = z.object({
  /** Valid for a few minutes; `extensions.install` takes it. */
  token: z.string(),
  repo: z.object({
    id: z.number().int(),
    name: z.string().nullable(),
    trust: repoTrustSchema,
    fingerprint: z.string().nullable(),
  }),
  extension: z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    apiVersion: z.number().int(),
    langs: z.array(z.string()),
    nsfw: z.boolean(),
    size: z.number().int(),
    sha256: z.string(),
  }),
  /** The version installed now, if any (an update shows no dialog, but the same data is used). */
  installedVersion: z.string().nullable(),
  warnings: z.array(installWarningSchema),
});
export type InstallPreparation = z.infer<typeof installPreparationSchema>;

export const repoRefreshResultSchema = z.object({
  refreshed: z.number().int(),
  failed: z.array(z.object({ repoId: z.number().int(), message: z.string() })),
});
export type RepoRefreshResult = z.infer<typeof repoRefreshResultSchema>;

export const updateAllResultSchema = z.object({
  updated: z.array(z.string()),
  failed: z.array(z.object({ id: z.string(), message: z.string() })),
});
export type UpdateAllResult = z.infer<typeof updateAllResultSchema>;
