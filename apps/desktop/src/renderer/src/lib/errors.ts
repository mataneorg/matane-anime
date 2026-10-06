import { AppError } from '@matane-anime/shared';
import type { TFunction } from 'i18next';

/** Plain words for a failure. `detail.kind` is the extension's typed error (or the runtime's code). */
export function describeError(error: unknown, t: TFunction): string {
  if (!(error instanceof AppError)) return t('errors.title');
  if (error.code === 'offline') return t('errors.offline');
  if (error.code === 'not_found') return t('errors.not_found');
  const kind = error.detail.kind;
  if (error.code === 'extension' && kind) {
    const key = `errors.${kind}`;
    const translated = t(key, { status: error.detail.status ?? '', defaultValue: '' });
    return translated || t('errors.unknown');
  }
  return error.message || t('errors.title');
}

/** A Cloudflare challenge the app could not pass on its own: retrying opens the verification window again. */
export const isCloudflare = (error: unknown): boolean =>
  error instanceof AppError && error.detail.kind === 'CloudflareError';
