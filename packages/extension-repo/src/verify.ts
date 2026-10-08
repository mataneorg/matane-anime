import { readArchive, type ExtensionPackage } from './archive';
import { RepoError } from './errors';
import { sha256Hex } from './hash';
import { MAX_ARCHIVE_BYTES, MAX_ICON_BYTES, type IndexEntry } from './index-file';

/** Languages of a manifest's sources, de-duplicated in order of appearance. */
export function languagesOf(sources: readonly { lang: string }[]): string[] {
  return [...new Set(sources.map((source) => source.lang))];
}

function sameSources(a: readonly object[], b: readonly object[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Checks downloaded bytes against an index entry: size, SHA-256, archive contents, manifest fields
 * (id, version, apiVersion, nsfw, languages, sources) and, when given, the icon. Throws `RepoError`.
 */
export function verifyPackage(
  entry: IndexEntry,
  archiveBytes: Uint8Array,
  iconBytes: Uint8Array | null,
): ExtensionPackage {
  if (archiveBytes.length > MAX_ARCHIVE_BYTES) {
    throw new RepoError('too_large', 'The archive is larger than allowed.');
  }
  if (archiveBytes.length !== entry.size) {
    throw new RepoError('size_mismatch', `The archive is ${archiveBytes.length} bytes; the index says ${entry.size}.`);
  }
  if (sha256Hex(archiveBytes) !== entry.sha256) {
    throw new RepoError('hash_mismatch', 'The archive does not match the SHA-256 in the index.');
  }
  const pkg = readArchive(archiveBytes);
  const { manifest } = pkg;
  const mismatch = (field: string): never => {
    throw new RepoError('manifest_mismatch', `The manifest ${field} differs from the index entry.`);
  };
  if (manifest.id !== entry.id) mismatch('id');
  if (manifest.version !== entry.version) mismatch('version');
  if (manifest.apiVersion !== entry.apiVersion) mismatch('apiVersion');
  if (manifest.nsfw !== entry.nsfw) mismatch('nsfw');
  if (JSON.stringify([...languagesOf(manifest.sources)].sort()) !== JSON.stringify([...new Set(entry.langs)].sort())) {
    mismatch('languages');
  }
  if (!sameSources(manifest.sources, entry.sources)) mismatch('sources');

  if (iconBytes !== null) {
    if (iconBytes.length > MAX_ICON_BYTES) throw new RepoError('too_large', 'The icon is larger than allowed.');
    if (iconBytes.length !== entry.iconSize || sha256Hex(iconBytes) !== entry.iconSha256) {
      throw new RepoError('icon_mismatch', 'The icon does not match the size and SHA-256 in the index.');
    }
  }
  return pkg;
}
