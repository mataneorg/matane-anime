import { readFile } from 'node:fs/promises';

export interface IconDeps {
  /** The folders an extension's `icon.png` may be in (its bundle folder, then the folder it was loaded from). */
  iconFolders?(extensionId: string): readonly string[];
  /** The icon a repository offers for an extension that is not installed (`?repo=<id>`); null when it has none. */
  repoIcon?(repoId: number, extensionId: string): Promise<Uint8Array | null>;
}

const ICON_MAX_BYTES = 256 * 1024;

/**
 * `anime://icon/<encodeURIComponent(extensionId)>`: serves `icon.png` of a loaded extension to `<img>`.
 * With `?repo=<id>` and no loaded copy it serves the icon that repository offers (Available tab, install dialog).
 * 404 when there is none, so the caller shows its letter.
 */
export function createIconHandler(deps: IconDeps): (request: Request) => Promise<Response> {
  const fail = (status: number): Response => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
  return async (request) => {
    if (request.method !== 'GET') return fail(405);
    const url = new URL(request.url);
    const segment = url.pathname.split('/').filter(Boolean)[0];
    if (!segment) return fail(400);
    let extensionId: string;
    try {
      extensionId = decodeURIComponent(segment);
    } catch {
      return fail(400);
    }
    for (const folder of deps.iconFolders?.(extensionId) ?? []) {
      try {
        const body = new Uint8Array(await readFile(`${folder}/icon.png`));
        if (body.byteLength === 0 || body.byteLength > ICON_MAX_BYTES) continue;
        // The file is replaced when the extension is updated or reloaded, so ask again each time.
        return new Response(body as BodyInit, {
          status: 200,
          headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' },
        });
      } catch {
        // Not in this folder; try the next one.
      }
    }
    const repoId = Number(url.searchParams.get('repo'));
    if (deps.repoIcon && Number.isInteger(repoId) && repoId > 0) {
      const body = await deps.repoIcon(repoId, extensionId).catch(() => null);
      if (body && body.byteLength > 0) {
        return new Response(body as BodyInit, {
          status: 200,
          headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' },
        });
      }
    }
    return fail(404);
  };
}
