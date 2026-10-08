// Builds extension repositories for tests: a Map of file name → bytes that `TestSite.setRepo` serves, with switches
// for every way a repository can go wrong. Pure apart from `loadBuiltExtension`, which reads a `dist/` folder.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  INDEX_FILE,
  MAX_ARCHIVE_BYTES,
  SIGNATURE_FILE,
  buildRepoFiles,
  fingerprint,
  generateKeyPair,
  signIndex,
  type PublicKey,
  type RepoKeyPair,
  type RepoPackageInput,
} from '@matane-anime/extension-repo';

/**
 * `extensions/example`, whose `dist/` (from `ma-ext build`) is the default content of a test repository. Found by
 * walking up from the working directory, because this file also runs where `import.meta` does not exist (Playwright
 * loads the e2e specs and what they import as CommonJS).
 */
export function exampleExtensionDir(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const candidate = join(dir, 'extensions/example');
    if (existsSync(join(candidate, 'manifest.json'))) return candidate;
    if (dirname(dir) === dir) throw new Error('extensions/example not found above the working directory');
  }
}

/** What `ma-ext build` leaves in `<dir>/dist`: index.js, manifest.json and icon.png. */
export function loadBuiltExtension(dir: string): RepoPackageInput {
  const dist = join(dir, 'dist');
  try {
    return {
      manifest: JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')) as RepoPackageInput['manifest'],
      code: readFileSync(join(dist, 'index.js'), 'utf8'),
      icon: readFileSync(join(dist, 'icon.png')),
    };
  } catch (error) {
    throw new Error(`${dist} is not a built extension (run \`ma-ext build ${dir}\`): ${(error as Error).message}`, {
      cause: error,
    });
  }
}

export interface TestRepoOptions {
  /** Repository name in `index.json`. Default "Test Repository". */
  name?: string;
  /** Built extension directories or ready packages. Default: `extensions/example`. */
  extensions?: (string | RepoPackageInput)[];
  /** Signs the index. Default: a fresh key pair, returned in the result. */
  keyPair?: RepoKeyPair;
  /** Index serial. Default 1. */
  serial?: number;
  generatedAt?: string;
  /** Makes `archive` and `icon` absolute (e.g. `site.repoUrl`); relative paths otherwise. */
  archiveBase?: string;

  /** Extension (id) the per-entry switches below act on. Default: the first one. */
  target?: string;
  /** Publishes the target as this version: new manifest version and a comment in the code, so the hash differs. */
  versionBump?: string;

  /** No `index.json.sig`. */
  unsigned?: boolean;
  /** The signature file is made by this key pair instead; `publicKey` of the result stays the legitimate one. */
  signedBy?: RepoKeyPair;
  /** The index says another SHA-256 for the target's archive (validly signed). */
  badArchiveHash?: boolean;
  /** The index says another size for the target's archive (validly signed). */
  badSize?: boolean;
  /** The target's archive is served with more bytes than the 20 MB limit (zeros), the index unchanged. */
  oversizedArchive?: boolean;
  /** `index.json` is not valid JSON (validly signed). */
  badIndexJson?: boolean;
  /** Changes `index.json` after it was signed, so the signature no longer matches. */
  tamperAfterSigning?: boolean;
}

export interface TestRepo {
  files: Map<string, Uint8Array>;
  /** Of the legitimate key pair (it signs unless `signedBy` or `unsigned`). */
  privateKeyPem: string;
  publicKey: PublicKey;
  /** `ed25519:abcd…ef12`, as the app shows it. */
  fingerprint: string;
}

interface RawEntry {
  id: string;
  sha256: string;
  size: number;
  archive: string;
}
interface RawIndex {
  name: string;
  extensions: RawEntry[];
}

const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('utf8');
const bytesOf = (value: string): Uint8Array => Buffer.from(value, 'utf8');
const serialize = (index: unknown): Uint8Array => bytesOf(`${JSON.stringify(index, null, 2)}\n`);

export function buildTestRepo(options: TestRepoOptions = {}): TestRepo {
  const keyPair = options.keyPair ?? generateKeyPair();
  const packages = (options.extensions ?? [exampleExtensionDir()]).map((item) =>
    typeof item === 'string' ? loadBuiltExtension(item) : item,
  );
  const targetPackage =
    options.target === undefined ? packages[0] : packages.find((p) => p.manifest.id === options.target);
  if (!targetPackage) throw new Error(`No extension ${options.target ?? '(none given)'} in the repository`);
  const targetId = targetPackage.manifest.id;

  const finalPackages = packages.map((pkg) => {
    if (pkg !== targetPackage || options.versionBump === undefined) return pkg;
    const code = typeof pkg.code === 'string' ? pkg.code : text(pkg.code);
    return {
      ...pkg,
      manifest: { ...pkg.manifest, version: options.versionBump },
      code: `${code}\n// version ${options.versionBump}\n`,
    };
  });

  const files = buildRepoFiles({
    name: options.name ?? 'Test Repository',
    serial: options.serial ?? 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    packages: finalPackages,
    ...(options.archiveBase === undefined ? {} : { archiveBase: options.archiveBase }),
  });

  const signer = options.signedBy ?? keyPair;
  const sign = (indexBytes: Uint8Array): void => {
    files.delete(SIGNATURE_FILE);
    if (!options.unsigned) files.set(SIGNATURE_FILE, bytesOf(signIndex(indexBytes, signer.privateKeyPem)));
  };

  const index = JSON.parse(text(files.get(INDEX_FILE) as Uint8Array)) as RawIndex;
  const entry = index.extensions.find((e) => e.id === targetId) as RawEntry;
  if (options.badArchiveHash) entry.sha256 = entry.sha256.replace(/^./, (c) => (c === '0' ? '1' : '0'));
  if (options.badSize) entry.size += 1;
  if (options.oversizedArchive) {
    // Whatever the index says, the server sends more than any archive may have.
    files.set(entry.archive.split('/').pop() as string, new Uint8Array(MAX_ARCHIVE_BYTES + 1));
  }

  let indexBytes = serialize(index);
  if (options.badIndexJson) indexBytes = bytesOf(`${text(indexBytes).slice(0, 40)}\n`);
  files.set(INDEX_FILE, indexBytes);
  sign(indexBytes);
  if (options.tamperAfterSigning) {
    files.set(INDEX_FILE, serialize({ ...index, name: `${index.name} (changed)` }));
  }

  return {
    files: new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    privateKeyPem: keyPair.privateKeyPem,
    publicKey: keyPair.publicKey,
    fingerprint: fingerprint(keyPair.publicKey),
  };
}
