import { type Session, app, session } from 'electron';
import { devServerUrl, isPermissionAllowed } from './renderer-url';

function lock(target: Session): void {
  const devUrl = (): string | undefined => devServerUrl(process.env['ELECTRON_RENDERER_URL'], app.isPackaged);
  target.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(isPermissionAllowed(permission, details.requestingUrl, devUrl()));
  });
  target.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    isPermissionAllowed(permission, requestingOrigin, devUrl()),
  );
}

let listening = false;

/**
 * Electron grants every permission request by default. The sessions here load sites the app does not control
 * (the Cloudflare challenge window, extension sessions), so each new session starts with everything refused
 * except what the renderer itself needs. Call it before `ready`, and again once the default session exists.
 */
export function installPermissionGuard(): void {
  if (!listening) {
    listening = true;
    app.on('session-created', lock);
  }
  if (app.isReady()) lock(session.defaultSession);
}
