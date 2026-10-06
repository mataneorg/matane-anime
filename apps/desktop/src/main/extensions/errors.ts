import { ExtensionRuntimeError } from '@matane-anime/extension-runtime/client';
import { AppError } from '@matane-anime/shared';

/**
 * What the UI gets when a call into an extension fails. `detail.kind` is the extension's typed error name
 * (`CloudflareError`, `HttpError`, `NotFoundError`, …) or the runtime's code (`timeout`, `interrupted`,
 * `memory`, `host_crashed`, `invalid_result`), so the screen can say the right thing and offer the right action.
 */
export function toAppError(error: unknown, online: boolean): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ExtensionRuntimeError) {
    if (error.code === 'unsupported') return new AppError('unsupported', error.message);
    const kind = error.code === 'extension' ? (error.typed ?? error.errorName ?? 'ExtensionError') : error.code;
    if (kind === 'NetworkError' && !online) return new AppError('offline', 'You are offline', { kind });
    return new AppError('extension', error.message, {
      kind,
      ...(error.status !== undefined && { status: error.status }),
    });
  }
  return new AppError('internal', error instanceof Error ? error.message : String(error));
}
