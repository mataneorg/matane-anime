export type RepoErrorCode =
  | 'bad_key'
  | 'bad_url'
  | 'bad_version'
  | 'index_too_large'
  | 'bad_index'
  | 'bad_signature_file'
  | 'bad_archive'
  | 'too_large'
  | 'incompatible_api'
  | 'size_mismatch'
  | 'hash_mismatch'
  | 'manifest_mismatch'
  | 'icon_mismatch';

/** Every failure of this package; `message` is short and safe to show to the user. */
export class RepoError extends Error {
  override readonly name = 'RepoError';

  readonly code: RepoErrorCode;

  // No parameter property: packages with `erasableSyntaxOnly` (the test site) type-check this file too.
  constructor(code: RepoErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function isRepoError(error: unknown): error is RepoError {
  return error instanceof RepoError;
}
