import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AnimeRepository } from '../db/repositories/anime';
import type { ExtensionFetcher } from '../network/extension-fetcher';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
};
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Permanent covers for library entries (docs/PRD.md LIB-7): saved once on disk, outside any cache, so the
 * library looks the same offline and after a site changes its images.
 */
export class LibraryCovers {
  private readonly dir: string;
  private readonly anime: AnimeRepository;
  private readonly fetcherFor: (sourceId: string) => ExtensionFetcher | undefined;
  private readonly onError: (message: string, error: unknown) => void;

  constructor(
    dir: string,
    anime: AnimeRepository,
    fetcherFor: (sourceId: string) => ExtensionFetcher | undefined,
    onError: (message: string, error: unknown) => void,
  ) {
    this.dir = dir;
    this.anime = anime;
    this.fetcherFor = fetcherFor;
    this.onError = onError;
  }

  /** Downloads the cover of an anime (again, if `force`). Never throws: a missing cover is not an error. */
  async ensure(animeId: number, force = false): Promise<void> {
    const row = this.anime.get(animeId);
    if (!row?.thumbnailUrl || (row.coverPath && !force)) return;
    const fetcher = this.fetcherFor(row.sourceId);
    if (!fetcher) return;
    try {
      const response = await fetcher.requestBytes(
        {
          url: row.thumbnailUrl,
          headers: { Referer: `${new URL(row.thumbnailUrl).origin}/`, Accept: 'image/*' },
        },
        { lane: 'image' },
      );
      const type = (response.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
      const extension = EXTENSIONS[type];
      if (response.status !== 200 || !extension || response.body.byteLength > MAX_BYTES) return;
      await mkdir(this.dir, { recursive: true });
      const path = join(this.dir, `${animeId}${extension}`);
      await writeFile(path, response.body);
      if (row.coverPath && row.coverPath !== path) await rm(row.coverPath, { force: true });
      this.anime.setCoverPath(animeId, path);
    } catch (error) {
      this.onError(`cover of anime ${animeId} could not be saved`, error);
    }
  }

  async remove(animeId: number): Promise<void> {
    const row = this.anime.get(animeId);
    if (!row?.coverPath) return;
    await rm(row.coverPath, { force: true });
    this.anime.setCoverPath(animeId, null);
  }

  /** The file and its type for `anime://cover/library/<id>`, if there is one. */
  localCover(animeId: number): { path: string; type: string } | null {
    const path = this.anime.get(animeId)?.coverPath;
    if (!path) return null;
    const type = Object.entries(EXTENSIONS).find(([, extension]) => path.endsWith(extension))?.[0];
    return type ? { path, type } : null;
  }
}
