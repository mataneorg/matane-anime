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

  constructor(
    readonly code: RepoErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function isRepoError(error: unknown): error is RepoError {
  return error instanceof RepoError;
}
