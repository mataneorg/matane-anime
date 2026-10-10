import {
  type IndexEntry,
  MAX_INDEX_BYTES,
  type PublicKey,
  type RepoIndex,
  RepoError,
  classifyRepo,
  fingerprint,
  isNewer,
  parseIndex,
  satisfiesMinAppVersion,
} from '@matane-anime/extension-repo';
import { API_VERSION } from '@matane-anime/extension-sdk/manifest';
import {
  AppError,
  type AvailableExtension,
  type RepoInfo,
  type RepoPreview,
  type RepoRefreshResult,
  type RepoTrust,
} from '@matane-anime/shared';
import type { ExtensionStore } from '../db/repositories/extension-store';
import type { RepoRow, RepoStore } from '../db/repositories/extension-repos';
import type { SettingsRepository } from '../db/repositories/settings';
import { allowsAnyLanguage, allowsNsfw } from './content-filter';
import { type RepoHttp, httpStatusOf, isRepoHttpError } from './repo-http';

const MAX_SIGNATURE_FETCH_BYTES = 8 * 1024;

export interface RepoServiceDeps {
  http: RepoHttp;
  repos: RepoStore;
  extensions: ExtensionStore;
  settings: SettingsRepository;
  /** `app.getVersion()`. */
  appVersion: string;
  now?(): number;
  /** A dev folder is loaded with this extension id (EXT-9: it wins over any repository). */
  isDevLoaded(extensionId: string): boolean;
  log?: { warn(message: string, error?: unknown): void };
}

/** What `ExtensionRegistry.info()` needs to know about the repository an extension came from. */
export interface RepoLookup {
  describe(repoId: number): { name: string | null; trust: RepoTrust } | null;
  /** The version offered by the repository when it is newer than `installedVersion`, else null. */
  newerVersion(repoId: number, extensionId: string, installedVersion: string): string | null;
}

interface FetchedIndex {
  indexBytes: Uint8Array;
  sigBytes: Uint8Array | null;
  index: RepoIndex;
}

interface Analysis {
  index: RepoIndex | null;
  trust: RepoTrust;
  announcedKey: PublicKey | null;
}

/** What a failed fetch was about: a stock part of a repository, or an extension by name. */
export type RepoSubject = 'index' | 'indexFile' | 'signature' | 'extension' | { name: string };

const subjectParams = (subject: RepoSubject | undefined): Record<string, string> =>
  subject === undefined ? {} : typeof subject === 'string' ? { subject } : { name: subject.name };

/**
 * Turns what the repository code can throw (network, format, integrity) into an error the user can read.
 * `what` is the English phrase for the message; `subject` lets the renderer say the same in its own language.
 */
export function toRepoAppError(error: unknown, what: string, subject?: RepoSubject): AppError {
  if (error instanceof AppError) return error;
  const about = subjectParams(subject);
  if (isRepoHttpError(error)) {
    if (error.code === 'offline') return new AppError('offline', 'You are offline');
    if (error.code === 'aborted') {
      return new AppError('cancelled', 'The request was cancelled', { key: 'requestCancelled' });
    }
    if (error.code === 'too_large') {
      return new AppError('invalid_input', `${capitalize(what)} is larger than allowed.`, {
        key: 'tooLarge',
        params: about,
      });
    }
    const status = httpStatusOf(error);
    if (status !== null) {
      return status === 404
        ? new AppError('network', `${capitalize(what)} was not found (the server answered 404).`, {
            key: 'notFound404',
            params: about,
          })
        : new AppError('network', `The server answered ${status} for ${what}.`, {
            key: 'serverStatus',
            params: { ...about, status },
          });
    }
    return new AppError('network', `Could not fetch ${what}: ${error.message}`, {
      key: 'fetchFailed',
      params: { ...about, detail: error.message },
    });
  }
  if (error instanceof RepoError) {
    // The part of a RepoError's message after the sentence is a technical detail that stays in English.
    const detail = { detail: error.message };
    switch (error.code) {
      case 'incompatible_api':
        return new AppError('unsupported', error.message);
      case 'hash_mismatch':
        return new AppError(
          'invalid_input',
          'The download does not match the SHA-256 in the repository index, so it was not installed.',
          { key: 'hashMismatch' },
        );
      case 'size_mismatch':
        return new AppError(
          'invalid_input',
          `The download does not have the size the index promises. ${error.message}`,
          { key: 'sizeMismatch', params: detail },
        );
      case 'icon_mismatch':
        return new AppError('invalid_input', error.message, { key: 'iconMismatch' });
      case 'manifest_mismatch':
        return new AppError('invalid_input', `The package contradicts the repository index. ${error.message}`, {
          key: 'manifestMismatch',
          params: detail,
        });
      case 'bad_archive':
        return new AppError('invalid_input', `The package is not a valid extension archive. ${error.message}`, {
          key: 'badArchive',
          params: detail,
        });
      case 'too_large':
        return new AppError('invalid_input', error.message, { key: 'packageTooLarge', params: detail });
      default:
        return new AppError('invalid_input', error.message, { key: 'indexInvalid', params: detail });
    }
  }
  return new AppError('internal', error instanceof Error ? error.message : String(error));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The exact bytes survive a round trip through a TEXT column (a leading BOM is kept, not dropped). */
const exactDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const toText = (bytes: Uint8Array): string => exactDecoder.decode(bytes);
const toBytes = (text: string): Uint8Array => Buffer.from(text, 'utf8');

/** Accepts `https://host/path`, `https://host/path/` and `https://host/path/index.json`. */
export function normalizeRepoUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AppError('invalid_input', 'That is not a valid address. Use a link like https://example.org/repo/', {
      key: 'repoAddressInvalid',
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('invalid_input', 'A repository address must start with http:// or https://.', {
      key: 'repoAddressScheme',
    });
  }
  if (url.username || url.password) {
    throw new AppError('invalid_input', 'A repository address must not contain a user name or password.', {
      key: 'repoAddressCredentials',
    });
  }
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/index\.json$/, '');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

/**
 * Repositories (docs/PRD.md EXT-5…7, EXT-15): adding, refreshing and trusting them, and what they offer.
 * Trust is the user's choice of a key (`public_key`); the key a repository announces never grants it.
 */
export class RepoService implements RepoLookup {
  private readonly now: () => number;
  private readonly inflight = new Map<number, Promise<void>>();
  private readonly analyses = new Map<
    number,
    { indexJson: string; signature: string | null; publicKey: string | null; analysis: Analysis }
  >();

  constructor(private readonly deps: RepoServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  // ------------------------------------------------------------------ add

  async preview(url: string): Promise<RepoPreview> {
    const base = normalizeRepoUrl(url);
    const fetched = await this.fetchIndex(base);
    const { status, announcedKey } = this.classify(fetched, null);
    if (status === 'invalid') throw invalidSignature();
    return {
      url: base,
      name: fetched.index.name,
      trust: status === 'unverified' ? 'unverified' : 'unsigned',
      signingKey: status === 'unverified' ? announcedKey : null,
      fingerprint: status === 'unverified' && announcedKey ? fingerprint(announcedKey) : null,
      extensionCount: fetched.index.extensions.length,
    };
  }

  async add(url: string, trustKey: boolean): Promise<RepoInfo> {
    const base = normalizeRepoUrl(url);
    if (this.deps.repos.getByUrl(base)) {
      throw new AppError('invalid_input', 'This repository was already added.', { key: 'repoAlreadyAdded' });
    }
    const fetched = await this.fetchIndex(base);
    const { status, announcedKey } = this.classify(fetched, null);
    if (status === 'invalid') throw invalidSignature();
    if (trustKey && status !== 'unverified') {
      throw new AppError('invalid_input', 'This repository is not signed, so there is no key to trust.', {
        key: 'repoNotSigned',
      });
    }
    const row = this.deps.repos.add(
      {
        url: base,
        name: fetched.index.name,
        indexJson: toText(fetched.indexBytes),
        signature: fetched.sigBytes ? toText(fetched.sigBytes) : null,
        signingKey: status === 'unverified' ? announcedKey : null,
        publicKey: trustKey ? announcedKey : null,
        serial: fetched.index.serial,
      },
      this.now(),
    );
    return this.toInfo(row);
  }

  remove(id: number): void {
    this.require(id);
    this.deps.repos.remove(id);
    this.analyses.delete(id);
  }

  // ------------------------------------------------------------------ trust

  setTrust(id: number, trusted: boolean): RepoInfo {
    const row = this.require(id);
    if (!trusted) {
      this.deps.repos.setTrustedKey(id, null);
    } else {
      const { index, trust, announcedKey } = this.analyseWithKey(row, null);
      if (index === null || trust !== 'unverified' || announcedKey === null) {
        throw new AppError('invalid_input', 'This repository has no valid signature, so there is no key to trust.', {
          key: 'repoNoKeyToTrust',
        });
      }
      this.deps.repos.setTrustedKey(id, announcedKey);
    }
    return this.toInfo(this.require(id));
  }

  // ------------------------------------------------------------------ refresh

  /** Re-reads one repository or all of them; a failing repository never stops the others. */
  async refresh(id?: number): Promise<RepoRefreshResult> {
    const rows = id === undefined ? this.deps.repos.list() : [this.require(id)];
    const failed: RepoRefreshResult['failed'] = [];
    let refreshed = 0;
    for (const row of rows) {
      try {
        await this.refreshOnce(row.id);
        refreshed++;
      } catch (error) {
        const app = toRepoAppError(error, 'the repository index', 'index');
        failed.push({ repoId: row.id, message: app.message });
        // Being offline says nothing about the repository: keep the earlier state of the row.
        if (app.code !== 'offline' && app.code !== 'cancelled') this.deps.repos.recordError(row.id, app.message);
        this.deps.log?.warn(`could not refresh ${row.url}`, error);
      }
    }
    return { refreshed, failed };
  }

  private refreshOnce(id: number): Promise<void> {
    const running = this.inflight.get(id);
    if (running) return running;
    const work = this.doRefresh(id).finally(() => this.inflight.delete(id));
    this.inflight.set(id, work);
    return work;
  }

  private async doRefresh(id: number): Promise<void> {
    const row = this.require(id);
    const fetched = await this.fetchIndex(row.url);
    const { status, announcedKey } = this.classify(fetched, row.publicKey);
    if (status === 'invalid') throw invalidSignature();
    if (row.publicKey !== null) {
      if (status === 'unsigned') {
        throw new AppError(
          'invalid_input',
          'The repository is trusted but its index is no longer signed. The new index was refused.',
          { key: 'repoSignatureRemoved' },
        );
      }
      if (status === 'key-changed') {
        throw new AppError(
          'invalid_input',
          'The repository is now signed with a different key than the one you trusted. The new index was refused; remove the repository and add it again to trust the new key.',
          { key: 'repoKeyChanged' },
        );
      }
    }
    if (fetched.index.serial < row.serial) {
      throw new AppError(
        'invalid_input',
        `The repository went back in time (serial ${fetched.index.serial}, last accepted ${row.serial}). The old index was kept.`,
        { key: 'repoWentBack', params: { serial: fetched.index.serial, accepted: row.serial } },
      );
    }
    this.deps.repos.saveAccepted(
      id,
      {
        name: fetched.index.name,
        indexJson: toText(fetched.indexBytes),
        signature: fetched.sigBytes ? toText(fetched.sigBytes) : null,
        signingKey: status === 'unsigned' ? null : announcedKey,
        serial: fetched.index.serial,
      },
      this.now(),
    );
    this.analyses.delete(id);
  }

  // ------------------------------------------------------------------ reading

  list(): RepoInfo[] {
    return this.deps.repos.list().map((row) => this.toInfo(row));
  }

  /** The stored index of a repository and the entry for an id, if both exist. */
  entryOf(repoId: number, extensionId: string): { repo: RepoRow; entry: IndexEntry; trust: RepoTrust } | null {
    const repo = this.deps.repos.get(repoId);
    if (!repo) return null;
    const { index, trust } = this.analyse(repo);
    const entry = index?.extensions.find((candidate) => candidate.id === extensionId);
    return entry ? { repo, entry, trust } : null;
  }

  describe(repoId: number): { name: string | null; trust: RepoTrust } | null {
    const row = this.deps.repos.get(repoId);
    return row ? { name: row.name, trust: this.analyse(row).trust } : null;
  }

  newerVersion(repoId: number, extensionId: string, installedVersion: string): string | null {
    const found = this.entryOf(repoId, extensionId);
    return found && isNewer(found.entry.version, installedVersion) ? found.entry.version : null;
  }

  /** Why an entry cannot be installed on this app, if it cannot. */
  incompatibility(entry: IndexEntry): 'api' | 'app' | null {
    if (entry.apiVersion > API_VERSION) return 'api';
    return satisfiesMinAppVersion(entry.minAppVersion, this.deps.appVersion) ? null : 'app';
  }

  /**
   * What the repositories offer, with the install state of each id. 18+ entries and entries in languages
   * the user did not choose are left out here, in main (EXT-15).
   */
  available(): AvailableExtension[] {
    const preferences = this.deps.settings.getAppSettings();
    const installed = new Map(this.deps.extensions.listExtensions().map((row) => [row.id, row]));
    const repoNames = new Map(this.deps.repos.list().map((row) => [row.id, row.name]));
    const out: AvailableExtension[] = [];
    for (const repo of this.deps.repos.list()) {
      const { index, trust } = this.analyse(repo);
      if (!index) continue;
      for (const entry of index.extensions) {
        if (!allowsNsfw(preferences, entry.nsfw)) continue;
        if (!allowsAnyLanguage(preferences.contentLanguages, entry.langs)) continue;
        const row = installed.get(entry.id);
        const devLoaded = this.deps.isDevLoaded(entry.id);
        const installedVersion = row && (row.origin === 'repo' || devLoaded) ? row.version : null;
        out.push({
          repoId: repo.id,
          repoName: repo.name,
          repoTrust: trust,
          id: entry.id,
          name: entry.name,
          version: entry.version,
          apiVersion: entry.apiVersion,
          nsfw: entry.nsfw,
          langs: entry.langs,
          sources: entry.sources.map(({ key, lang, name }) => ({ key, lang, name })),
          size: entry.size,
          installedVersion,
          updateAvailable: row?.origin === 'repo' && row.repoId === repo.id && isNewer(entry.version, row.version),
          incompatible: this.incompatibility(entry),
          conflict: devLoaded
            ? { kind: 'dev' }
            : row?.origin === 'repo' && row.repoId !== null && row.repoId !== repo.id
              ? { kind: 'repo', repoId: row.repoId, repoName: repoNames.get(row.repoId) ?? null }
              : null,
        });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ internals

  private require(id: number): RepoRow {
    const row = this.deps.repos.get(id);
    if (!row) throw new AppError('not_found', 'That repository is no longer in the list.', { key: 'repoGone' });
    return row;
  }

  /** `index.json` and, if there is one, `index.json.sig` (a missing signature file means unsigned). */
  private async fetchIndex(base: string): Promise<FetchedIndex> {
    const { http } = this.deps;
    let indexBytes: Uint8Array;
    try {
      indexBytes = (await http.get(`${base}index.json`, { maxBytes: MAX_INDEX_BYTES })).bytes;
    } catch (error) {
      throw toRepoAppError(error, 'the repository index (index.json)', 'indexFile');
    }
    let sigBytes: Uint8Array | null = null;
    try {
      sigBytes = (await http.get(`${base}index.json.sig`, { maxBytes: MAX_SIGNATURE_FETCH_BYTES })).bytes;
    } catch (error) {
      const status = httpStatusOf(error);
      if (status !== 404 && status !== 410)
        throw toRepoAppError(error, 'the signature file (index.json.sig)', 'signature');
    }
    try {
      return { indexBytes, sigBytes, index: parseIndex(indexBytes) };
    } catch (error) {
      throw toRepoAppError(error, 'the repository index', 'index');
    }
  }

  private classify(fetched: FetchedIndex, trustedKey: PublicKey | null) {
    return classifyRepo({ indexBytes: fetched.indexBytes, sigBytes: fetched.sigBytes, trustedKey });
  }

  /** Parses and verifies the stored index (cached until the row changes). */
  private analyse(row: RepoRow): Analysis {
    const cached = this.analyses.get(row.id);
    if (
      cached &&
      cached.indexJson === row.indexJson &&
      cached.signature === row.signature &&
      cached.publicKey === row.publicKey
    ) {
      return cached.analysis;
    }
    const analysis = this.analyseWithKey(row, row.publicKey);
    this.analyses.set(row.id, {
      indexJson: row.indexJson ?? '',
      signature: row.signature,
      publicKey: row.publicKey,
      analysis,
    });
    return analysis;
  }

  private analyseWithKey(row: RepoRow, trustedKey: PublicKey | null): Analysis {
    if (row.indexJson === null) return { index: null, trust: 'unsigned', announcedKey: null };
    const indexBytes = toBytes(row.indexJson);
    const index = ((): RepoIndex | null => {
      try {
        return parseIndex(indexBytes);
      } catch {
        return null;
      }
    })();
    const { status, announcedKey } = classifyRepo({
      indexBytes,
      sigBytes: row.signature === null ? null : toBytes(row.signature),
      trustedKey,
    });
    // A signature that no longer verifies, or a key other than the trusted one, is never shown as trusted.
    const trust: RepoTrust = status === 'trusted' ? 'trusted' : status === 'unverified' ? 'unverified' : 'unsigned';
    return { index, trust, announcedKey };
  }

  private toInfo(row: RepoRow): RepoInfo {
    const { index, trust } = this.analyse(row);
    return {
      id: row.id,
      url: row.url,
      name: row.name,
      trust,
      signingKey: row.signingKey,
      fingerprint: row.signingKey ? fingerprint(row.signingKey) : null,
      lastFetchedAt: row.lastFetchedAt,
      lastError: row.lastError,
      extensionCount: index?.extensions.length ?? 0,
    };
  }
}

function invalidSignature(): AppError {
  return new AppError(
    'invalid_input',
    'The signature of this repository does not match its index. It may have been tampered with, so it was not added.',
    { key: 'repoSignatureInvalid' },
  );
}
