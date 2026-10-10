import { readFile } from 'node:fs/promises';

export interface IconDeps {
  /** The folders an extension's `icon.png` may be in (its bundle folder, then the folder it was loaded from). */
  iconFolders?(extensionId: string): readonly string[];
}

const ICON_MAX_BYTES = 256 * 1024;

/** `anime://icon/<encodeURIComponent(extensionId)>`: serves `icon.png` of a loaded extension to `<img>`; 404 when it has none, so the caller shows its letter. */
export function createIconHandler(deps: IconDeps): (request: Request) => Promise<Response> {
  const fail = (status: number): Response => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
  return async (request) => {
    if (request.method !== 'GET') return fail(405);
    const segment = new URL(request.url).pathname.split('/').filter(Boolean)[0];
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
    return fail(404);
  };
}
