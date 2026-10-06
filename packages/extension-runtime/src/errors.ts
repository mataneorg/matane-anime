import { type ExtensionErrorName, isExtensionErrorName } from '@matane-anime/extension-sdk';

/** What a failed guest call or host op looks like on the wire between sandbox, host and app. */
export interface SerializedError {
  name: string;
  message: string;
  status?: number;
}

export type RuntimeErrorCode =
  /** The extension threw (a typed error such as `ParseError`, or any other exception). */
  | 'extension'
  /** The call used up its time budget (30 s, 60 s for `getEpisodes`). */
  | 'timeout'
  /** The extension ran synchronous code longer than the limit (2 s) and was interrupted. */
  | 'interrupted'
  /** The extension used more than its memory limit (64 MB). */
  | 'memory'
  /** The runtime was disposed while the call was running. */
  | 'disposed'
  /** The extension returned something that does not match the contract. */
  | 'invalid_result'
  /** The source does not implement the method (an optional one). */
  | 'unsupported';

/** Everything the host throws for a call into an extension. */
export class ExtensionRuntimeError extends Error {
  override name = 'ExtensionRuntimeError';
  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
    /** For `extension`: the name the extension's error carried, e.g. `HttpError`. */
    readonly errorName?: string,
    readonly status?: number,
  ) {
    super(message);
  }

  /** The typed SDK error name when the extension threw one, else undefined. */
  get typed(): ExtensionErrorName | undefined {
    return isExtensionErrorName(this.errorName) ? this.errorName : undefined;
  }
}

/** Thrown by a `HostApi` implementation (the app's network layer, the CLI's fetch) with a typed name. */
export class HostError extends Error {
  override name = 'HostError';
  constructor(
    readonly errorName: ExtensionErrorName | 'ExtensionError',
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof HostError) {
    return {
      name: error.errorName,
      message: error.message,
      ...(error.status !== undefined && { status: error.status }),
    };
  }
  if (error instanceof ExtensionRuntimeError && error.errorName) {
    return {
      name: error.errorName,
      message: error.message,
      ...(error.status !== undefined && { status: error.status }),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { name: 'ExtensionError', message };
}
