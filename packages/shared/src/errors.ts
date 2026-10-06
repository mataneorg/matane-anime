// Typed errors that survive IPC: Electron only transfers an error's message, so main encodes the code
// into the message and the renderer decodes it again.
export const ERROR_CODES = [
  'invalid_input',
  'not_found',
  'unsupported',
  'network',
  'forbidden',
  'disabled',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

const PREFIX = '@@appError:';

/** What main throws from an IPC handler. */
export function encodeIpcError(error: unknown): Error {
  const code: ErrorCode = error instanceof AppError ? error.code : 'internal';
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${PREFIX}${JSON.stringify({ code, message })}`);
}

/** What the renderer makes of an error that came back from `invoke`. */
export function decodeIpcError(error: unknown): AppError {
  const text = error instanceof Error ? error.message : String(error);
  const at = text.indexOf(PREFIX);
  if (at >= 0) {
    try {
      const data = JSON.parse(text.slice(at + PREFIX.length)) as { code?: string; message?: string };
      const code = (ERROR_CODES as readonly string[]).includes(data.code ?? '') ? (data.code as ErrorCode) : 'internal';
      return new AppError(code, data.message ?? text);
    } catch {
      // fall through to a plain internal error
    }
  }
  return new AppError('internal', text);
}
