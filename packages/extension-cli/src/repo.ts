import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import {
  INDEX_FILE,
  MAX_ARCHIVE_BYTES,
  MAX_ICON_BYTES,
  MAX_INDEX_BYTES,
  SIGNATURE_FILE,
  buildRepoFiles,
  classifyRepo,
  fingerprint,
  generateKeyPair,
  isRepoError,
  isSemver,
  parseIndex,
  parsePublicKey,
  publicKeyOf,
  resolveUrl,
  verifyRepoFiles,
  type PublicKey,
  type RepoIndex,
  type RepoProblem,
  type RepoTrust,
} from '@matane-anime/extension-repo';
import { BuildError, readManifest } from './build.js';

const PRIVATE_KEY_FILE = 'repo-key.pem';
const PUBLIC_KEY_FILE = 'repo-key.pub';
const MAX_SIGNATURE_READ = 8 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const PNG_MAGIC = Buffer.from('89504e470d0a1a0a', 'hex');

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Writes next to the target and renames, so a reader never sees half a file. */
async function writeAtomic(path: string, data: Uint8Array): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, data);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

// ------------------------------------------------------------------------------------------------- keygen

export interface KeygenResult {
  privateKeyPath: string;
  publicKeyPath: string;
  publicKey: PublicKey;
  fingerprint: string;
}

/** Writes `repo-key.pem` (PKCS8, mode 0600) and `repo-key.pub` into `outDir`; never overwrites. */
export async function keygen(outDir = '.'): Promise<KeygenResult> {
  const dir = resolve(outDir);
  const privateKeyPath = join(dir, PRIVATE_KEY_FILE);
  const publicKeyPath = join(dir, PUBLIC_KEY_FILE);
  for (const path of [privateKeyPath, publicKeyPath]) {
    if (await exists(path)) {
      throw new BuildError(`${path} already exists; refusing to overwrite a key. Move it or choose another --out.`);
    }
  }
  await mkdir(dir, { recursive: true });
  const { privateKeyPem, publicKey } = generateKeyPair();
  // "wx" fails if the file appeared meanwhile; the mode applies at creation, so the key is never world-readable.
  await writeFile(privateKeyPath, privateKeyPem, { flag: 'wx', mode: 0o600 });
  await chmod(privateKeyPath, 0o600);
  await writeFile(publicKeyPath, `${publicKey}\n`, { flag: 'wx', mode: 0o644 });
  return { privateKeyPath, publicKeyPath, publicKey, fingerprint: fingerprint(publicKey) };
}

// ------------------------------------------------------------------------------------------------- build

export interface RepoBuildOptions {
  /** Directory to write the repository into; created if needed. */
  out: string;
  name: string;
  /** Path of the PKCS8 PEM written by `repo keygen`. */
  key?: string;
  /** Explicit choice to publish without a signature. */
  unsigned?: boolean;
  serial?: number;
  /** Makes `archive` and `icon` in the index absolute URLs. */
  baseUrl?: string;
  /** The oldest app version that may install these extensions (`minAppVersion` of every entry). */
  minAppVersion?: string;
}

export interface RepoBuildResult {
  out: string;
  serial: number;
  /** Written paths relative to `out`, index last. */
  files: string[];
  extensions: { id: string; version: string }[];
  /** Null for an unsigned repository. */
  publicKey: PublicKey | null;
  warnings: string[];
}

async function readBuiltExtension(directory: string) {
  const dir = resolve(directory);
  const dist = join(dir, 'dist');
  const shown = relative(process.cwd(), dir) || '.';
  const code = await readFile(join(dist, 'index.js')).catch(() => null);
  const hasManifest = await exists(join(dist, 'manifest.json'));
  if (code === null || !hasManifest) {
    throw new BuildError(
      `${shown} has no built bundle (dist/index.js and dist/manifest.json). Run \`ma-ext build ${shown}\` first.`,
    );
  }
  const manifest = await readManifest(dist);
  const source = await readManifest(dir).catch(() => null);
  if (source && source.version !== manifest.version) {
    throw new BuildError(
      `${shown}/dist is stale: it holds ${manifest.id}@${manifest.version} but manifest.json says ${source.version}. Run \`ma-ext build ${shown}\` again.`,
    );
  }
  const icon = await readFile(join(dist, 'icon.png')).catch(() => null);
  if (icon === null) {
    throw new BuildError(
      `${shown} has no icon: repositories require one. Put an icon.png (at most ${MAX_ICON_BYTES / 1024} KB) next to manifest.json and run \`ma-ext build ${shown}\`.`,
    );
  }
  return { manifest, code, icon };
}

/** The serial of the repository already in `out`, if there is one. */
async function previousSerial(out: string, explicitSerial: boolean): Promise<number | null> {
  const bytes = await readFile(join(out, INDEX_FILE)).catch(() => null);
  if (bytes === null) return null;
  try {
    return parseIndex(bytes).serial;
  } catch {
    if (explicitSerial) return null;
    throw new BuildError(
      `${join(out, INDEX_FILE)} exists but is not a valid index, so the next serial is unknown. Fix or remove it, or pass --serial.`,
    );
  }
}

/**
 * Builds a repository from already built extension directories (`ma-ext build`) into `out`. The new index lists
 * exactly the given extensions; unrelated files in `out`, and archives of older versions, are left alone.
 */
export async function buildRepo(directories: string[], options: RepoBuildOptions): Promise<RepoBuildResult> {
  if (directories.length === 0) throw new BuildError('Give at least one extension directory.');
  if (options.key !== undefined && options.unsigned) throw new BuildError('Use either --key or --unsigned, not both.');
  if (options.key === undefined && !options.unsigned) {
    throw new BuildError(
      'A repository is signed by default: pass --key <repo-key.pem> (create one with `ma-ext repo keygen`), or --unsigned to publish without a signature.',
    );
  }
  if (options.baseUrl !== undefined) {
    let protocol: string;
    try {
      protocol = new URL(options.baseUrl).protocol;
    } catch {
      protocol = '';
    }
    if (protocol !== 'http:' && protocol !== 'https:') throw new BuildError('--base-url must be an http(s) URL.');
  }

  if (options.minAppVersion !== undefined && !isSemver(options.minAppVersion)) {
    throw new BuildError(`--min-app-version must be a version like 0.2.0, not "${options.minAppVersion}".`);
  }

  let privateKeyPem: string | undefined;
  let publicKey: PublicKey | null = null;
  if (options.key !== undefined) {
    privateKeyPem = await readFile(options.key, 'utf8').catch((error: Error) => {
      throw new BuildError(`Cannot read the key ${options.key}: ${error.message}`);
    });
    try {
      publicKey = publicKeyOf(privateKeyPem);
    } catch (error) {
      throw new BuildError(`${options.key}: ${(error as Error).message}`);
    }
  }

  const packages = [];
  for (const directory of directories) {
    const built = await readBuiltExtension(directory);
    packages.push(options.minAppVersion === undefined ? built : { ...built, minAppVersion: options.minAppVersion });
  }

  const out = resolve(options.out);
  const previous = await previousSerial(out, options.serial !== undefined);
  const warnings: string[] = [];
  const serial = options.serial ?? (previous === null ? 1 : previous + 1);
  if (options.serial !== undefined && previous !== null && options.serial < previous) {
    warnings.push(
      `--serial ${options.serial} is lower than the previous ${previous}: apps that saw the previous index will refuse this one.`,
    );
  }
  if (options.unsigned) {
    warnings.push(
      'Unsigned repository: users will see "Unverified repository" and cannot be protected against tampering.',
    );
  }

  const files = buildRepoFiles({
    name: options.name,
    serial,
    generatedAt: new Date().toISOString(),
    packages,
    ...(privateKeyPem === undefined ? {} : { privateKeyPem }),
    ...(options.baseUrl === undefined ? {} : { archiveBase: options.baseUrl }),
  });

  await mkdir(out, { recursive: true });
  // Archives and icons first, then the index that refers to them; an unsigned build drops a stale signature.
  const written: string[] = [];
  const ordered = [...files].sort(([a], [b]) => rank(a) - rank(b));
  if (!files.has(SIGNATURE_FILE)) await rm(join(out, SIGNATURE_FILE), { force: true });
  for (const [name, data] of ordered) {
    await writeAtomic(join(out, name), data);
    written.push(name);
  }
  return {
    out,
    serial,
    files: written,
    extensions: packages.map((pkg) => ({ id: pkg.manifest.id, version: pkg.manifest.version })),
    publicKey,
    warnings,
  };
}

const rank = (name: string): number => (name === INDEX_FILE ? 2 : name === SIGNATURE_FILE ? 3 : 1);

// ------------------------------------------------------------------------------------------------- verify

export interface VerifyReport {
  source: string;
  name: string | null;
  serial: number | null;
  generatedAt: string | null;
  extensions: { id: string; name: string; version: string }[];
  /** `unsigned`, `invalid`, `unverified` (valid, no key given), `trusted` (matches --key) or `key-changed`. */
  signature: RepoTrust;
  announcedKey: PublicKey | null;
  fingerprint: string | null;
  /** True when `--key` was given, so the signer was compared with it. */
  keyChecked: boolean;
  problems: RepoProblem[];
  warnings: string[];
  ok: boolean;
}

type Loaded = { bytes: Uint8Array } | { error: string; absent: boolean };

interface Loader {
  load(ref: string, limit: number): Promise<Loaded>;
}

/** Same path a repository file has in `verifyRepoFiles`: relative to the index, or the last segment of a URL. */
function fileKey(ref: string): string {
  const url = new URL(ref, 'http://repo.invalid/');
  const pathname = decodeURIComponent(url.pathname);
  return /^[a-z][a-z0-9+.-]*:/i.test(ref) ? (pathname.split('/').pop() ?? '') : pathname.slice(1);
}

function directoryLoader(directory: string): Loader {
  const dir = resolve(directory);
  return {
    async load(ref, limit) {
      let handle;
      try {
        handle = await open(join(dir, fileKey(ref)), 'r');
        // One byte past the limit is enough for the library to call the file too large.
        const buffer = Buffer.alloc(Math.min((await handle.stat()).size, limit + 1));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return { bytes: buffer.subarray(0, bytesRead) };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return { error: `cannot read ${ref}: ${(error as Error).message}`, absent: code === 'ENOENT' };
      } finally {
        await handle?.close();
      }
    },
  };
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks);
}

function httpLoader(url: string): Loader {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.search = '';
  // Accept both the repository folder and the URL of index.json itself.
  const base = parsed.pathname.endsWith('/index.json')
    ? new URL('.', parsed).href
    : `${parsed.href.replace(/\/+$/, '')}/`;
  return {
    async load(ref, limit) {
      let target: string;
      try {
        target = resolveUrl(base, ref);
      } catch (error) {
        return { error: (error as Error).message, absent: false };
      }
      try {
        const response = await fetch(target, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
        if (!response.ok) {
          return { error: `${target} answered HTTP ${response.status}`, absent: response.status === 404 };
        }
        return { bytes: await readLimited(response, limit) };
      } catch (error) {
        return { error: `${target} could not be fetched: ${(error as Error).message}`, absent: false };
      }
    },
  };
}

/**
 * Checks a repository in a directory or at an http(s) URL: signature, every archive (size, SHA-256, contents,
 * manifest against the entry) and icon. With `trustedKey`, also that the index is signed by that key.
 * Problems are reported, not thrown; only a malformed `trustedKey` throws.
 */
export async function verifyRepo(source: string, options: { key?: string } = {}): Promise<VerifyReport> {
  let trustedKey: PublicKey | null = null;
  if (options.key !== undefined) {
    try {
      trustedKey = parsePublicKey(options.key.trim());
    } catch (error) {
      throw new BuildError(`--key: ${(error as Error).message}`);
    }
  }
  const remote = /^https?:\/\//i.test(source);
  let loader: Loader;
  try {
    loader = remote ? httpLoader(source) : directoryLoader(source);
  } catch {
    throw new BuildError(`${source} is not a valid URL.`);
  }

  const files = new Map<string, Uint8Array>();
  const extra: RepoProblem[] = [];
  /** Why a file could not be loaded; replaces the generic "missing" message of the library. */
  const loadErrors = new Map<string, string>();
  const take = async (ref: string, limit: number): Promise<Loaded> => {
    const loaded = await loader.load(ref, limit);
    if ('bytes' in loaded) files.set(fileKey(ref), loaded.bytes);
    else loadErrors.set(ref, loaded.error);
    return loaded;
  };

  const indexLoaded = await take(INDEX_FILE, MAX_INDEX_BYTES);
  const sigLoaded = await take(SIGNATURE_FILE, MAX_SIGNATURE_READ);
  if ('error' in sigLoaded && !sigLoaded.absent) {
    extra.push({ code: 'missing_file', file: SIGNATURE_FILE, message: `index.json.sig: ${sigLoaded.error}` });
  }

  let index: RepoIndex | null = null;
  if ('bytes' in indexLoaded) {
    try {
      index = parseIndex(indexLoaded.bytes);
    } catch (error) {
      if (!isRepoError(error)) throw error;
    }
  }
  for (const entry of index?.extensions ?? []) {
    await take(entry.archive, MAX_ARCHIVE_BYTES);
    await take(entry.icon, MAX_ICON_BYTES);
  }

  const problems: RepoProblem[] = [
    ...extra,
    ...verifyRepoFiles(files, { trustedKey }).map((problem) => {
      const reason = problem.code === 'missing_file' ? loadErrors.get(problem.file) : undefined;
      return reason === undefined ? problem : { ...problem, message: `${problem.message} (${reason})` };
    }),
  ];

  const warnings: string[] = [];
  const indexBytes = files.get(INDEX_FILE);
  const { status, announcedKey } = indexBytes
    ? classifyRepo({ indexBytes, sigBytes: files.get(SIGNATURE_FILE) ?? null, trustedKey })
    : { status: 'unsigned' as RepoTrust, announcedKey: null };
  if (indexBytes && status === 'unsigned' && trustedKey === null) {
    warnings.push('The repository is not signed: users will see "Unverified repository".');
  }
  if (announcedKey !== null && trustedKey === null && status === 'unverified') {
    warnings.push('No --key given: the signature is valid for the announced key, but nobody checked it is yours.');
  }
  if (index) {
    if (index.serial === 0) warnings.push('serial is 0; `ma-ext repo build` starts at 1.');
    if (Date.parse(index.generatedAt) > Date.now() + 24 * 3600_000) warnings.push('generatedAt is in the future.');
    if (index.extensions.length === 0) warnings.push('The repository lists no extensions.');
    for (const entry of index.extensions) {
      const icon = files.get(fileKey(entry.icon));
      if (icon && !Buffer.from(icon.subarray(0, 8)).equals(PNG_MAGIC)) {
        warnings.push(`The icon of ${entry.id} is not a PNG file.`);
      }
    }
  }

  return {
    source,
    name: index?.name ?? null,
    serial: index?.serial ?? null,
    generatedAt: index?.generatedAt ?? null,
    extensions: (index?.extensions ?? []).map(({ id, name, version }) => ({ id, name, version })),
    signature: status,
    announcedKey,
    fingerprint: announcedKey ? fingerprint(announcedKey) : null,
    keyChecked: trustedKey !== null,
    problems,
    warnings,
    ok: problems.length === 0,
  };
}
