import { type Session, app } from 'electron';
import { isPrivateHost } from './policy';

/**
 * Extensions and the playlists they resolve name their own hosts, so without this a hostile one could make the
 * app send requests to the router, a service on this machine or a cloud metadata address. Only the e2e suite
 * (its fake site is on 127.0.0.1) and an unpackaged build may switch it off.
 */
export function allowPrivateNetwork(): boolean {
  return !app.isPackaged && process.env['MATANE_ALLOW_PRIVATE_NETWORK'] === '1';
}

export function isBlockedUrl(url: string): boolean {
  try {
    return isPrivateHost(new URL(url).hostname) && !allowPrivateNetwork();
  } catch {
    return false;
  }
}

const installed = new WeakSet<Session>();

/** Cancels every request of the session, redirect hops included, that targets a private address. */
export function installPrivateNetworkGuard(target: Session): void {
  if (installed.has(target)) return;
  installed.add(target);
  target.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => callback({ cancel: isBlockedUrl(details.url) }),
  );
}
