import type { ProxyCredentials } from './config';

// An authenticating proxy asks for a login per request (`net.request` emits `login` on the request, a window on `app`).
// The answer comes from the settings and the keyring; `apply.ts` keeps the provider current.

let provider: () => ProxyCredentials | null = () => null;

export function setProxyCredentialsProvider(next: () => ProxyCredentials | null): void {
  provider = next;
}

/** Answers a proxy challenge with the saved login; anything else (a site's own login) is cancelled. */
export function answerProxyLogin(
  authInfo: { isProxy: boolean },
  callback: (username?: string, password?: string) => void,
): void {
  const credentials = authInfo.isProxy ? provider() : null;
  if (credentials) callback(credentials.username, credentials.password);
  else callback();
}
