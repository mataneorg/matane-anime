import { type Session, app } from 'electron';
import { sanitizeUserAgent } from './policy';

/** The User-Agent a session sends by default: Chrome's, without the Electron and app tokens (NET-4). */
export function defaultUserAgent(target: Session): string {
  // Chromium writes the app's name without spaces: "Matane Anime" becomes "MataneAnime/1.0.0".
  return sanitizeUserAgent(target.getUserAgent(), `${app.getName().replace(/\s+/g, '')}/${app.getVersion()}`);
}
