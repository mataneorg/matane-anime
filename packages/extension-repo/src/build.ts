import type { ExtensionManifest } from '@matane-anime/extension-sdk/manifest';
import { buildArchive, sha256Hex } from './archive';

import { INDEX_FILE, INDEX_FORMAT, SIGNATURE_FILE, parseIndex, type IndexEntry, type RepoIndex } from './index-file';
import { classifyRepo, signIndex } from './signature';
import { languagesOf, verifyPackage } from './verify';
import type { PublicKey } from './keys';
import { isRepoError, type RepoErrorCode } from './errors';

export interface RepoPackageInput {
  manifest: ExtensionManifest;
  code: string | Uint8Array;
  icon: Uint8Array;
  minAppVersion?: string;
}

export interface BuildRepoOptions {
  name: string;
  serial: number;
  generatedAt: string;
  packages: RepoPackageInput[];
  /** Signs `index.json` when given; otherwise no `index.json.sig` is produced. */
  privateKeyPem?: string;
  /** Prefix for archive and icon references (a URL ending in "/" or not); relative paths when omitted. */
  archiveBase?: string;
}

export function archiveFileName(manifest: Pick<ExtensionManifest, 'id' | 'version'>): string {
  return `${manifest.id}-${manifest.version}.zip`;
}

export function iconFileName(manifest: Pick<ExtensionManifest, 'id'>): string {
  return `${manifest.id}.png`;
}

/** Files of a static repository: `index.json`, `index.json.sig` (signed only), `<id>-<version>.zip`, `<id>.png`. */
export function buildRepoFiles(options: BuildRepoOptions): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const base = options.archiveBase === undefined ? '' : options.archiveBase.replace(/\/+$/, '') + '/';
  const entries: IndexEntry[] = [];

  for (const pkg of options.packages) {
    const archive = buildArchive(pkg);
    const archiveName = archiveFileName(pkg.manifest);
    const iconName = iconFileName(pkg.manifest);
    entries.push({
      id: pkg.manifest.id,
      name: pkg.manifest.name,
      version: pkg.manifest.version,
      apiVersion: pkg.manifest.apiVersion,
      ...(pkg.minAppVersion === undefined ? {} : { minAppVersion: pkg.minAppVersion }),
      nsfw: pkg.manifest.nsfw,
      langs: languagesOf(pkg.manifest.sources),
      sources: pkg.manifest.sources.map(({ key, lang, name }) => ({ key, lang, name })),
      archive: `${base}${archiveName}`,
      sha256: sha256Hex(archive),
      size: archive.length,
      icon: `${base}${iconName}`,
      iconSha256: sha256Hex(pkg.icon),
      iconSize: pkg.icon.length,
    });
    files.set(archiveName, archive);
    files.set(iconName, pkg.icon);
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const index: RepoIndex = {
    format: INDEX_FORMAT,
    name: options.name,
    serial: options.serial,
    generatedAt: options.generatedAt,
    extensions: entries,
  };
  const indexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`, 'utf8');
  // Refuse to emit an index that this package itself would reject (duplicate ids, bad serial, …).
  parseIndex(indexBytes);
  files.set(INDEX_FILE, indexBytes);
  if (options.privateKeyPem !== undefined) {
    files.set(SIGNATURE_FILE, Buffer.from(signIndex(indexBytes, options.privateKeyPem), 'utf8'));
  }
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export type RepoProblemCode = RepoErrorCode | 'missing_file' | 'unsigned' | 'invalid_signature' | 'key_changed';

export interface RepoProblem {
  code: RepoProblemCode;
  /** The repository file concerned (`index.json`, an archive path, …). */
  file: string;
  message: string;
  /** Extension id, when the problem is about one entry. */
  id?: string;
}

/** Finds a file of the repository for an entry reference; an absolute URL falls back to its last path segment. */
function lookup(files: ReadonlyMap<string, Uint8Array>, ref: string): Uint8Array | undefined {
  let path: string;
  try {
    const url = new URL(ref, 'http://repo.invalid/');
    const pathname = decodeURIComponent(url.pathname);
    path = /^[a-z][a-z0-9+.-]*:/i.test(ref) ? (pathname.split('/').pop() ?? '') : pathname.slice(1);
  } catch {
    return undefined;
  }
  return files.get(path);
}

/**
 * Re-checks a whole repository held in memory: the signature (against `trustedKey` when given), every archive
 * against its entry, and every icon. An empty result means the repository is consistent.
 */
export function verifyRepoFiles(
  files: ReadonlyMap<string, Uint8Array>,
  options: { trustedKey?: PublicKey | null } = {},
): RepoProblem[] {
  const problems: RepoProblem[] = [];
  const indexBytes = files.get(INDEX_FILE);
  if (!indexBytes) return [{ code: 'missing_file', file: INDEX_FILE, message: 'index.json is missing.' }];

  const trustedKey = options.trustedKey ?? null;
  const sigBytes = files.get(SIGNATURE_FILE) ?? null;
  const { status } = classifyRepo({ indexBytes, sigBytes, trustedKey });
  if (status === 'unsigned' && trustedKey !== null) {
    problems.push({ code: 'unsigned', file: SIGNATURE_FILE, message: 'The repository is not signed.' });
  } else if (status === 'invalid') {
    problems.push({
      code: 'invalid_signature',
      file: SIGNATURE_FILE,
      message: 'The signature does not match index.json.',
    });
  } else if (status === 'key-changed') {
    problems.push({
      code: 'key_changed',
      file: SIGNATURE_FILE,
      message: 'The repository is signed with a different key than the trusted one.',
    });
  }

  let index: RepoIndex;
  try {
    index = parseIndex(indexBytes);
  } catch (error) {
    if (!isRepoError(error)) throw error;
    return [...problems, { code: error.code, file: INDEX_FILE, message: error.message }];
  }

  for (const entry of index.extensions) {
    const archive = lookup(files, entry.archive);
    const icon = lookup(files, entry.icon);
    if (!icon) {
      problems.push({
        code: 'missing_file',
        file: entry.icon,
        id: entry.id,
        message: `The icon of ${entry.id} is missing.`,
      });
    }
    if (!archive) {
      problems.push({
        code: 'missing_file',
        file: entry.archive,
        id: entry.id,
        message: `The archive of ${entry.id} is missing.`,
      });
      continue;
    }
    try {
      verifyPackage(entry, archive, icon ?? null);
    } catch (error) {
      if (!isRepoError(error)) throw error;
      problems.push({
        code: error.code,
        file: error.code === 'icon_mismatch' ? entry.icon : entry.archive,
        id: entry.id,
        message: error.message,
      });
    }
  }
  return problems;
}
