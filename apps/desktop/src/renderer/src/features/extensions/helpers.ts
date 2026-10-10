import type { AvailableExtension, ExtensionInfo, RepoInfo, RepoTrust, SourceInfo } from '@matane-anime/shared';

/** Offered as language chips even when no installed or offered source uses them yet (mockup 10c). */
export const COMMON_LANGUAGES = ['en', 'id', 'ja', 'es'] as const;

/** The hue of an extension's letter avatar, stable per id. */
export const hue = (text: string): number => [...text].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;

export interface TrustView {
  /** A key under `extensions.trust.*`. */
  label: 'trusted' | 'unverified' | 'unsigned' | 'dev';
  /** `ok` is the shield, `warn` the triangle. */
  tone: 'ok' | 'warn';
}

/** How a repository's trust is shown: trusted is calm, anything else is a warning (EXT-6). `null` is a dev folder. */
export function trustView(trust: RepoTrust | null): TrustView {
  if (trust === null) return { label: 'dev', tone: 'ok' };
  if (trust === 'trusted') return { label: 'trusted', tone: 'ok' };
  return { label: trust, tone: 'warn' };
}

/** `38 KB`, `1.2 MB`: sizes in the lists and in the install dialog. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The start and the end of a digest, for display (`e3b0c442…b855`). */
export function shortHash(hash: string): string {
  return hash.length <= 16 ? hash : `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

/** The language of a source as a name in the app language (`en` → English); the code itself if unknown. */
export function languageName(code: string, locale: string): string {
  if (code === 'multi') return code;
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The chips for Content language: the usual languages, the ones installed and offered sources use, and anything
 * already selected (so a choice can always be undone). The usual ones come first, then the rest alphabetically.
 */
export function languageOptions(found: readonly string[], selected: readonly string[]): string[] {
  const known = new Set<string>(COMMON_LANGUAGES);
  const rest = new Set([...found, ...selected].map((code) => code.toLowerCase()));
  rest.delete('multi');
  for (const code of known) rest.delete(code);
  return [...COMMON_LANGUAGES, ...[...rest].sort()];
}

/** Adds or removes a language; an empty result means every language. */
export function toggleLanguage(selected: readonly string[], code: string): string[] {
  return selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code];
}

/** The languages of everything the page shows, for the filter. */
export function languagesInUse(
  extensions: readonly ExtensionInfo[],
  available: readonly AvailableExtension[],
): string[] {
  return [
    ...extensions.flatMap((extension) => extension.sources.map((source) => source.lang)),
    ...available.flatMap((entry) => entry.langs),
  ].map((code) => code.toLowerCase());
}

/** Installed extensions in a steady order: updates first, then the ones that failed, then by name. */
export function sortInstalled(extensions: readonly ExtensionInfo[]): ExtensionInfo[] {
  const rank = (extension: ExtensionInfo): number =>
    extension.updateAvailable !== null ? 0 : extension.status === 'error' ? 1 : 2;
  return [...extensions].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function countUpdates(extensions: readonly ExtensionInfo[]): number {
  return extensions.filter((extension) => extension.updateAvailable !== null && !extension.shadowed).length;
}

/** Offered extensions: updates first, then by name, then by repository. */
export function sortAvailable(entries: readonly AvailableExtension[]): AvailableExtension[] {
  return [...entries].sort(
    (a, b) =>
      Number(b.updateAvailable) - Number(a.updateAvailable) ||
      a.name.localeCompare(b.name) ||
      (a.repoName ?? '').localeCompare(b.repoName ?? ''),
  );
}

export type AvailableState =
  | { kind: 'install' }
  | { kind: 'update' }
  | { kind: 'installed' }
  | { kind: 'incompatible'; reason: 'api' | 'app' }
  | { kind: 'conflict'; with: { kind: 'dev' } | { kind: 'repo'; name: string | null } };

/** What the button of an offered extension does, or why there is none. */
export function availableState(entry: AvailableExtension): AvailableState {
  if (entry.incompatible) return { kind: 'incompatible', reason: entry.incompatible };
  if (entry.conflict) {
    return {
      kind: 'conflict',
      with: entry.conflict.kind === 'dev' ? { kind: 'dev' } : { kind: 'repo', name: entry.conflict.repoName },
    };
  }
  if (entry.updateAvailable) return { kind: 'update' };
  return entry.installedVersion === null ? { kind: 'install' } : { kind: 'installed' };
}

/**
 * The note under an installed row: another repository also offers this id (the mockup's "Also offered by X, which
 * stays uninstalled"). Returns the names of the repositories offering it that the copy did not come from.
 */
export function alsoOfferedBy(extension: ExtensionInfo, available: readonly AvailableExtension[]): string[] {
  const names = available
    .filter((entry) => entry.id === extension.id && entry.repoId !== extension.repoId && entry.repoName)
    .map((entry) => entry.repoName as string);
  return [...new Set(names)];
}

/** Repositories with a problem first (so it is seen), then alphabetically. */
export function sortRepos(repos: readonly RepoInfo[]): RepoInfo[] {
  return [...repos].sort(
    (a, b) =>
      Number(b.lastError !== null) - Number(a.lastError !== null) || (a.name ?? a.url).localeCompare(b.name ?? b.url),
  );
}

export interface ReloadSummary {
  reloaded: number;
  /** One entry per folder that did not come back ready: the extension (or folder) and why. */
  failed: { name: string; message: string }[];
}

/**
 * Reads the dev folders again one after the other (two folders may hold the same extension id, and the registry
 * handles one change at a time). A folder that fails to load is not an exception: it comes back as a result with
 * status `error`, so both kinds are collected and the rest still reload.
 */
export async function reloadSequentially(
  folders: readonly string[],
  reload: (folder: string) => Promise<Pick<ExtensionInfo, 'name' | 'status' | 'error'>>,
): Promise<ReloadSummary> {
  const summary: ReloadSummary = { reloaded: 0, failed: [] };
  for (const folder of folders) {
    try {
      const info = await reload(folder);
      if (info.status === 'error') summary.failed.push({ name: info.name, message: info.error ?? folder });
      else summary.reloaded += 1;
    } catch (error) {
      summary.failed.push({ name: folder, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return summary;
}

/** The sources opened most recently, newest first. Sources that are not installed cannot be opened, so they are left out. */
export function recentSources(sources: readonly SourceInfo[], count: number): SourceInfo[] {
  return sources
    .filter((source) => source.available && source.lastUsedAt !== null)
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    .slice(0, count);
}
