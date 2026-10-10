import { AppError } from '@matane-anime/shared';
import type { TFunction } from 'i18next';

/**
 * Main tags some failures with a stable `detail.key`; its text is `errors.main.<key>`. A key this build does not
 * know (an older catalog, a newer main) gives '', and the caller falls back to the English `message`.
 */
function describeMainError(error: AppError, t: TFunction): string {
  const { key, params } = error.detail;
  if (!key) return '';
  const values: Record<string, string | number> = { ...params };
  // `subject` names a stock thing ("the repository index"); `name` is an extension's own name, quoted.
  if (typeof params?.subject === 'string') {
    values.subject = t(`errors.mainSubject.${params.subject}`, { defaultValue: params.subject });
  } else if (typeof params?.name === 'string') {
    values.subject = `"${params.name}"`;
  }
  return t(`errors.main.${key}`, { ...values, defaultValue: '' });
}

/** Plain words for a failure. `detail.kind` is the extension's typed error (or the runtime's code). */
export function describeError(error: unknown, t: TFunction): string {
  if (!(error instanceof AppError)) return t('errors.title');
  const stable = describeMainError(error, t);
  if (stable) return stable;
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
