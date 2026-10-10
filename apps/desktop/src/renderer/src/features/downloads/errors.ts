/** Codes main keeps in `downloads.error` (see `DOWNLOAD_ERRORS` in main/downloads/service.ts). */
const KNOWN = new Set([
  'live',
  'no_stream',
  'no_extension',
  'unsupported_encryption',
  'size_limit',
  'disk_space',
  'write_failed',
  'disk_full',
  'too_large',
  'expired',
  'network',
  'unreachable',
  'redirect',
  'file_missing',
]);

export type DownloadErrorText =
  | { key: `downloads.errors.${string}`; values?: { status: string } }
  /** Not a code: what the engine reported, shown as it is. */
  | { raw: string };

/** Which translation a stored error code maps to. `http_<status>` carries its status along. */
export function describeDownloadError(error: string | null): DownloadErrorText {
  if (!error) return { key: 'downloads.errors.unknown' };
  if (KNOWN.has(error)) return { key: `downloads.errors.${error}` };
  const http = /^http_(\d{3})$/.exec(error);
  if (http) {
    const status = http[1] as string;
    return { key: 'downloads.errors.http', values: { status } };
  }
  return { raw: error };
}
