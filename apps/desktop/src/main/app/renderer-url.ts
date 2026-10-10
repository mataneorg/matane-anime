// Which pages count as the app's own renderer, kept free of Electron so it can be tested.

/** Permissions the renderer itself asks for: the player's fullscreen button and "copy" in the log dialogs. */
export const RENDERER_PERMISSIONS: ReadonlySet<string> = new Set(['fullscreen', 'clipboard-sanitized-write']);

/**
 * The dev server only exists in an unpackaged build. A packaged app ignores `ELECTRON_RENDERER_URL`: whoever
 * can set the variable could otherwise make it load, and hand its IPC to, any page.
 */
export function devServerUrl(value: string | undefined, packaged: boolean): string | undefined {
  return !packaged && value ? value : undefined;
}

/** The packaged `file://` page, or a page on the dev server's origin (not merely a URL that starts like it). */
export function isTrustedRendererUrl(url: string, devUrl: string | undefined): boolean {
  if (url.startsWith('file://')) return true;
  if (!devUrl) return false;
  try {
    return new URL(url).origin === new URL(devUrl).origin;
  } catch {
    return false;
  }
}

/** Everything else a page can ask for (camera, location, notifications, …) is refused, for every session. */
export function isPermissionAllowed(permission: string, url: string, devUrl: string | undefined): boolean {
  return RENDERER_PERMISSIONS.has(permission) && isTrustedRendererUrl(url, devUrl);
}
