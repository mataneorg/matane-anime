// Typed errors that survive IPC: Electron only transfers an error's message, so main encodes the code
// into the message and the renderer decodes it again.
export const ERROR_CODES = [
  'invalid_input',
  'not_found',
  'unsupported',
  'network',
  'forbidden',
  'disabled',
  /** A call into an extension failed; `detail.kind` says how (`CloudflareError`, `HttpError`, `timeout`, …). */
  'extension',
  'cancelled',
  'offline',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** The `detail.key` values main uses for repository and install failures; each has an `errors.main.*` text. */
export const MAIN_ERROR_KEYS = [
  // repositories
  'repoAddressInvalid',
  'repoAddressScheme',
  'repoAddressCredentials',
  'repoAlreadyAdded',
  'repoNotSigned',
  'repoNoKeyToTrust',
  'repoGone',
  'repoSignatureInvalid',
  'repoSignatureRemoved',
  'repoKeyChanged',
  'repoWentBack',
  // fetching and verifying
  'requestCancelled',
  'tooLarge',
  'notFound404',
  'serverStatus',
  'fetchFailed',
  'hashMismatch',
  'sizeMismatch',
  'iconMismatch',
  'manifestMismatch',
  'badArchive',
  'packageTooLarge',
  'indexInvalid',
  // installing
  'extensionNotOffered',
  'installExpired',
  'installRepoRemoved',
  'notFromRepo',
  'repoOfExtensionRemoved',
  'repoNoLongerOffers',
  'upToDate',
  'notInstalled',
  'installedFromFolder',
  'devFolderRunning',
  'apiTooNew',
  'appTooOld',
  'devFolderBlocksInstall',
  'installedFromOtherRepo',
  'installedFromAnotherRepo',
  'invalidExtensionId',
  'writeFailed',
  'installFailed',
  'loadFailed',
] as const;
export type MainErrorKey = (typeof MAIN_ERROR_KEYS)[number];

/** Extra facts about a failure that the UI acts on (e.g. offering "Verify" for a Cloudflare challenge). */
export interface ErrorDetail {
  /** The extension's typed error name, or a runtime code such as `timeout`, `interrupted`, `memory`. */
  kind?: string;
  /** HTTP status, for `HttpError`. */
  status?: number;
  /**
   * A stable id of what went wrong, for the renderer to say it in the user's language (`errors.main.<key>`).
   * `AppError.message` stays the English text for logs; an unknown key just shows that message.
   */
  key?: MainErrorKey;
  /** The values the text of `key` needs. */
  params?: Record<string, string | number>;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly detail: ErrorDetail;
  constructor(code: ErrorCode, message: string, detail: ErrorDetail = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }
}

const PREFIX = '@@appError:';

/** What main throws from an IPC handler. */
export function encodeIpcError(error: unknown): Error {
  const code: ErrorCode = error instanceof AppError ? error.code : 'internal';
  const message = error instanceof Error ? error.message : String(error);
  const detail = error instanceof AppError ? error.detail : {};
  return new Error(`${PREFIX}${JSON.stringify({ code, message, detail })}`);
}

/** What the renderer makes of an error that came back from `invoke`. */
export function decodeIpcError(error: unknown): AppError {
  const text = error instanceof Error ? error.message : String(error);
  const at = text.indexOf(PREFIX);
  if (at >= 0) {
    try {
      const data = JSON.parse(text.slice(at + PREFIX.length)) as {
        code?: string;
        message?: string;
        detail?: ErrorDetail;
      };
      const code = (ERROR_CODES as readonly string[]).includes(data.code ?? '') ? (data.code as ErrorCode) : 'internal';
      return new AppError(code, data.message ?? text, data.detail ?? {});
    } catch {
      // fall through to a plain internal error
    }
  }
  return new AppError('internal', text);
}
