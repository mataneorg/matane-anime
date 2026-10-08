/** What the renderer can read on a failed response (the CORS-exposed `x-error-code` header). */
export type ErrorCode =
  | 'bad_request'
  | 'session_not_found'
  | 'host_not_allowed'
  | 'method_not_allowed'
  | 'network'
  | 'path_not_allowed'
  | 'file_missing'
  | `http_${number}`;

export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'x-error-code, content-range, content-length, accept-ranges',
};

export function failure(status: number, code: ErrorCode): Response {
  return new Response(null, {
    status,
    headers: { ...CORS_HEADERS, 'x-error-code': code, 'cache-control': 'no-store' },
  });
}
