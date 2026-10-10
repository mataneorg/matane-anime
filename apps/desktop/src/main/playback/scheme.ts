import { protocol } from 'electron';
import { type CoverDeps, createCoverHandler } from './covers';
import { type IconDeps, createIconHandler } from './icons';
import { ANIME_SCHEME, type AnimeHandlerDeps, createAnimeHandler } from './proxy';

/**
 * Must run before the app is ready. `standard` + `secure` make `anime://play/…` behave like https URLs
 * (relative resolution, MSE), `stream` lets `<video>` stream and seek, `supportFetchAPI` + `corsEnabled`
 * let hls.js use fetch/XHR. CSP still applies: the page needs `media-src anime: blob:` and
 * `connect-src anime:` (apps/desktop/src/renderer/index.html).
 */
export function registerAnimeScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ANIME_SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

/** Attaches the handlers once the app is ready: `anime://play/…` (media) and `anime://cover/…` (images) and `anime://icon/…` (extension icons). */
export function handleAnimeScheme(deps: AnimeHandlerDeps & CoverDeps & IconDeps): void {
  const play = createAnimeHandler(deps);
  const cover = createCoverHandler(deps);
  const icon = createIconHandler(deps);
  protocol.handle(ANIME_SCHEME, (request) => {
    const host = new URL(request.url).host;
    return host === 'cover' ? cover(request) : host === 'icon' ? icon(request) : play(request);
  });
}
