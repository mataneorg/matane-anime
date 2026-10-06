import { AppError } from '@matane-anime/shared';

/**
 * Calls the renderer may cancel (`requests.cancel`): TanStack Query aborts a query, the renderer tells
 * main, and main stops waiting. The extension's work in the sandbox is not interrupted, only abandoned.
 */
export class RequestRegistry {
  private readonly controllers = new Map<string, AbortController>();

  begin(requestId: string | undefined): { signal: AbortSignal; done(): void } {
    const controller = new AbortController();
    if (requestId) this.controllers.set(requestId, controller);
    return {
      signal: controller.signal,
      done: () => {
        if (requestId && this.controllers.get(requestId) === controller) this.controllers.delete(requestId);
      },
    };
  }

  cancel(requestId: string): void {
    this.controllers.get(requestId)?.abort();
    this.controllers.delete(requestId);
  }
}

/** Resolves with `promise`, or rejects as soon as `signal` aborts. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new AppError('cancelled', 'The request was cancelled'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new AppError('cancelled', 'The request was cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
