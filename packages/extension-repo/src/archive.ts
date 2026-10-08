import { Inflate, zipSync, type Zippable } from 'fflate';
import { API_VERSION, manifestSchema, type ExtensionManifest } from '@matane-anime/extension-sdk/manifest';
import { RepoError } from './errors';
import { MAX_ARCHIVE_BYTES, MAX_BUNDLE_BYTES, MAX_ICON_BYTES } from './index-file';

export { sha256Hex } from './hash';

export const ARCHIVE_FILES = ['manifest.json', 'index.js', 'icon.png'] as const;
export const MAX_MANIFEST_BYTES = 64 * 1024;

export interface ArchiveLimits {
  maxArchiveBytes: number;
  maxManifestBytes: number;
  maxBundleBytes: number;
  maxIconBytes: number;
}

const DEFAULT_LIMITS: ArchiveLimits = {
  maxArchiveBytes: MAX_ARCHIVE_BYTES,
  maxManifestBytes: MAX_MANIFEST_BYTES,
  maxBundleBytes: MAX_BUNDLE_BYTES,
  maxIconBytes: MAX_ICON_BYTES,
};

export interface ExtensionPackage {
  manifest: ExtensionManifest;
  /** Exact bytes of `index.js`. */
  code: Uint8Array;
  /** Exact bytes of `icon.png`. */
  icon: Uint8Array;
}

function limitFor(name: string, limits: ArchiveLimits): number {
  if (name === 'manifest.json') return limits.maxManifestBytes;
  if (name === 'index.js') return limits.maxBundleBytes;
  return limits.maxIconBytes;
}

function parseManifest(bytes: Uint8Array): ExtensionManifest {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new RepoError('bad_archive', 'manifest.json is not valid UTF-8 JSON.');
  }
  const result = manifestSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join('.')})` : '';
    throw new RepoError('bad_archive', `manifest.json is invalid${where}: ${issue?.message ?? 'unknown error'}.`);
  }
  if (result.data.apiVersion > API_VERSION) {
    throw new RepoError(
      'incompatible_api',
      `This extension needs API ${result.data.apiVersion}; this app supports up to ${API_VERSION}. Update the app.`,
    );
  }
  return result.data;
}

/**
 * Deterministic zip: exactly `manifest.json`, `index.js`, `icon.png` in that order, fixed timestamps,
 * so the same input always gives the same bytes (and the same hash).
 */
export function buildArchive(input: {
  manifest: ExtensionManifest;
  code: string | Uint8Array;
  icon: Uint8Array;
}): Uint8Array {
  const manifest = parseManifest(Buffer.from(JSON.stringify(input.manifest), 'utf8'));
  const code = typeof input.code === 'string' ? Buffer.from(input.code, 'utf8') : input.code;
  if (code.length > MAX_BUNDLE_BYTES) {
    throw new RepoError('too_large', `index.js is larger than ${MAX_BUNDLE_BYTES / (1024 * 1024)} MB.`);
  }
  if (input.icon.length === 0 || input.icon.length > MAX_ICON_BYTES) {
    throw new RepoError('too_large', `icon.png must be between 1 byte and ${MAX_ICON_BYTES / 1024} KB.`);
  }
  // fflate reads the date with local getters, so a local-time constructor is stable in every time zone.
  const mtime = new Date(2000, 0, 1, 0, 0, 0);
  const options = { level: 9, mtime } as const;
  const files: Zippable = {
    'manifest.json': [Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'), options],
    'index.js': [code, options],
    'icon.png': [input.icon, options],
  };
  return zipSync(files);
}

interface CentralEntry {
  name: string;
  /** Declared uncompressed size. */
  size: number;
  compressedSize: number;
  method: number;
  localOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const INFLATE_CHUNK = 64 * 1024;

/** Reads the central directory ourselves for what fflate does not report (flags) and to reject oddities early. */
function scanCentralDirectory(bytes: Uint8Array, limits: ArchiveLimits): CentralEntry[] {
  const fail = (message: string): never => {
    throw new RepoError('bad_archive', message);
  };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return fail('The archive is not a zip file.');
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) fail('Zip64 archives are not supported.');
  if (count > 16) fail('The archive has too many entries.');
  if (cdOffset + cdSize > eocd) fail('The archive directory is corrupt.');

  const entries: CentralEntry[] = [];
  const seen = new Set<string>();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CENTRAL_SIGNATURE)
      fail('The archive directory is corrupt.');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    if (p + 46 + nameLength > bytes.length) fail('The archive directory is corrupt.');
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLength);
    let name: string;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    } catch {
      return fail('The archive has an entry with an invalid name.');
    }
    p += 46 + nameLength + extraLength + commentLength;

    if (name.includes('\0') || name.includes('/') || name.includes('\\') || name.includes('..')) {
      fail('The archive contains an unsafe path.');
    }
    if (flags & (0x1 | 0x40 | 0x2000)) fail('Encrypted archives are not supported.');
    if (method !== 0 && method !== 8) fail('The archive uses an unsupported compression method.');
    if (!(ARCHIVE_FILES as readonly string[]).includes(name))
      fail(`The archive contains an unexpected entry "${name}".`);
    if (seen.has(name)) fail(`The archive contains "${name}" twice.`);
    seen.add(name);
    if (size > limitFor(name, limits)) {
      throw new RepoError('too_large', `${name} is larger than allowed.`);
    }
    entries.push({ name, size, compressedSize, method, localOffset });
  }
  for (const required of ARCHIVE_FILES) {
    if (!seen.has(required)) fail(`The archive is missing ${required}.`);
  }
  return entries;
}

/** Extracts one entry, never producing more than its declared size (a lying archive is a bad archive). */
function extract(bytes: Uint8Array, entry: CentralEntry): Uint8Array {
  const corrupt = () => new RepoError('bad_archive', `${entry.name} is corrupt or does not match its declared size.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = entry.localOffset;
  if (header + 30 > bytes.length || view.getUint32(header, true) !== LOCAL_SIGNATURE) throw corrupt();
  const nameLength = view.getUint16(header + 26, true);
  const start = header + 30 + nameLength + view.getUint16(header + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw corrupt();
  const localName = Buffer.from(bytes.subarray(header + 30, header + 30 + nameLength)).toString('utf8');
  if (localName !== entry.name) throw corrupt();
  const body = bytes.subarray(start, end);

  if (entry.method === 0) {
    if (body.length !== entry.size) throw corrupt();
    return body.slice();
  }
  const out = new Uint8Array(entry.size);
  let written = 0;
  let finished = false;
  const inflate = new Inflate((chunk, final) => {
    if (written + chunk.length > entry.size) throw corrupt();
    out.set(chunk, written);
    written += chunk.length;
    if (final) finished = true;
  });
  try {
    for (let offset = 0; offset < body.length || offset === 0; offset += INFLATE_CHUNK) {
      inflate.push(body.subarray(offset, offset + INFLATE_CHUNK), offset + INFLATE_CHUNK >= body.length);
    }
  } catch (error) {
    if (error instanceof RepoError) throw error;
    throw corrupt();
  }
  if (!finished || written !== entry.size) throw corrupt();
  return out;
}

/**
 * Reads and validates an extension archive. Rejects extra entries, unsafe paths, encryption, unknown compression,
 * oversized files (declared sizes are checked before inflating, and inflating stops at the declared size, so a
 * compression bomb never grows past the limits) and an invalid manifest, or an `apiVersion` newer than this app
 * supports (`incompatible_api`).
 */
export function readArchive(bytes: Uint8Array, limits: Partial<ArchiveLimits> = {}): ExtensionPackage {
  const effective: ArchiveLimits = { ...DEFAULT_LIMITS, ...limits };
  if (bytes.length > effective.maxArchiveBytes) {
    throw new RepoError('too_large', 'The archive is larger than allowed.');
  }
  const files = new Map(scanCentralDirectory(bytes, effective).map((entry) => [entry.name, extract(bytes, entry)]));
  return {
    manifest: parseManifest(files.get('manifest.json')!),
    code: files.get('index.js')!,
    icon: files.get('icon.png')!,
  };
}
