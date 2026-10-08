import { z } from 'zod';
import { RepoError } from './errors';
import { SEMVER_PATTERN } from './versions';

/** EXT-5 limits; the bundle limit is the same as `ma-ext build`. */
export const MAX_INDEX_BYTES = 2 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
export const MAX_ICON_BYTES = 512 * 1024;
export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

export const INDEX_FORMAT = 1;
export const INDEX_FILE = 'index.json';
export const SIGNATURE_FILE = 'index.json.sig';

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** A reference is a path relative to the index URL or an absolute http(s) URL; never another scheme. */
function isSafeReference(ref: string): boolean {
  if (ref.length === 0 || ref.length > 2048) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f\\]/.test(ref)) return false;
  if (ref.startsWith('//')) return false;
  if (SCHEME.test(ref)) {
    try {
      const { protocol } = new URL(ref);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }
  return true;
}

const referenceSchema = z.string().refine(isSafeReference, {
  error: 'must be a relative path or an http(s) URL',
});

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lower-case hex characters');
const semverSchema = z.string().regex(SEMVER_PATTERN, 'must be a semantic version, e.g. 1.0.0');

const entrySourceSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  lang: z.string().regex(/^(multi|[a-z]{2,3}(-[A-Za-z0-9]+)?)$/),
  name: z.string().min(1),
});

export const indexEntrySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'lower-case letters, digits and "-", starting with a letter'),
  name: z.string().min(1),
  version: semverSchema,
  apiVersion: z.number().int().positive(),
  minAppVersion: semverSchema.optional(),
  nsfw: z.boolean(),
  langs: z.array(z.string().regex(/^(multi|[a-z]{2,3}(-[A-Za-z0-9]+)?)$/)),
  sources: z.array(entrySourceSchema),
  archive: referenceSchema,
  sha256: sha256Schema,
  size: z.number().int().positive().max(MAX_ARCHIVE_BYTES),
  icon: referenceSchema,
  iconSha256: sha256Schema,
  iconSize: z.number().int().positive().max(MAX_ICON_BYTES),
});

export const indexSchema = z
  .object({
    format: z.literal(INDEX_FORMAT),
    name: z.string().min(1).max(200),
    /** Raised on every build; apps refuse an index with a lower serial than the one they know. */
    serial: z.number().int().nonnegative(),
    generatedAt: z.iso.datetime({ offset: true }),
    extensions: z.array(indexEntrySchema),
  })
  .refine((index) => new Set(index.extensions.map((entry) => entry.id)).size === index.extensions.length, {
    error: 'extension ids must be unique',
    path: ['extensions'],
  });

export type IndexEntry = z.infer<typeof indexEntrySchema>;
export type RepoIndex = z.infer<typeof indexSchema>;

/** Parses the exact bytes of `index.json`. Only throws `RepoError` (`index_too_large` or `bad_index`). */
export function parseIndex(bytes: Uint8Array): RepoIndex {
  if (bytes.length > MAX_INDEX_BYTES) {
    throw new RepoError('index_too_large', `index.json is larger than ${MAX_INDEX_BYTES / (1024 * 1024)} MB.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new RepoError('bad_index', 'index.json is not valid UTF-8 JSON.');
  }
  const result = indexSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join('.')})` : '';
    throw new RepoError('bad_index', `index.json is invalid${where}: ${issue?.message ?? 'unknown error'}.`);
  }
  return result.data;
}

/** Resolves an entry reference against the index URL. Only http and https results are allowed. */
export function resolveUrl(base: string, ref: string): string {
  let url: URL;
  try {
    if (!isSafeReference(ref)) throw new Error('unsafe');
    url = new URL(ref, base);
  } catch {
    throw new RepoError('bad_url', 'A repository reference is not a valid http(s) URL or relative path.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RepoError('bad_url', 'Repository URLs must use http or https.');
  }
  return url.href;
}
