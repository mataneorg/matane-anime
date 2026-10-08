import { describe, expect, it } from 'vitest';
import { describeDownloadError } from './errors';

describe('describeDownloadError', () => {
  it('maps each code the engine stores to its own text', () => {
    for (const code of [
      'live',
      'no_stream',
      'no_extension',
      'unsupported_encryption',
      'size_limit',
      'disk_space',
      'write_failed',
      'disk_full',
      'expired',
      'network',
      'unreachable',
      'redirect',
      'file_missing',
    ]) {
      expect(describeDownloadError(code)).toEqual({ key: `downloads.errors.${code}` });
    }
  });
  it('carries the status of an HTTP error', () => {
    expect(describeDownloadError('http_403')).toEqual({ key: 'downloads.errors.http', values: { status: '403' } });
  });
  it('shows anything else as it is, and says "unknown" for nothing', () => {
    expect(describeDownloadError('ENOENT: no such file')).toEqual({ raw: 'ENOENT: no such file' });
    expect(describeDownloadError('http_4')).toEqual({ raw: 'http_4' });
    expect(describeDownloadError(null)).toEqual({ key: 'downloads.errors.unknown' });
  });
});
