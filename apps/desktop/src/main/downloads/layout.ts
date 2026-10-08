import { join } from 'node:path';

// Where an episode goes on disk (docs/PRD.md DL-6): <folder>/<Source (LANG)>/<Anime>/<Episode>/ for HLS,
// <folder>/<Source (LANG)>/<Anime>/<Episode>.mp4 for a file. Names are safe on Windows, macOS and Linux.
// The result is stored in `downloads.path` and never computed again, so a later rename of the anime or a
// change of rules cannot orphan files.

const MAX_NAME_BYTES = 120;
const FORBIDDEN = /[<>:"/\\|?*]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Cuts to a UTF-8 byte budget without splitting a character. */
function truncate(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let out = '';
  for (const char of text) {
    if (Buffer.byteLength(out + char) > maxBytes) break;
    out += char;
  }
  return out;
}

/** A single path component that no OS refuses. Never empty. */
export function sanitizeName(raw: string, fallback = '_'): string {
  let name = [...raw.normalize('NFC')]
    .map((char) => (char < ' ' || char === '\u007f' ? '_' : char))
    .join('')
    .replace(FORBIDDEN, '_')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows drops trailing dots and spaces; a leading dot hides the folder on Unix and makes "." or "..".
    .replace(/^\.+/, (dots) => '_'.repeat(dots.length))
    .replace(/[. ]+$/, '');
  name = truncate(name, MAX_NAME_BYTES).replace(/[. ]+$/, '');
  if (name === '') name = fallback;
  return RESERVED.test(name) ? `_${name}` : name;
}

export interface EpisodeNaming {
  number: number | null;
  name: string;
  variant?: string | null;
}

/** "Episode 3", or "Episode 3 [Dub]" when two variants of a number exist. */
export function episodeLabel(episode: EpisodeNaming): string {
  const base = episode.name.trim() || (episode.number !== null ? `Episode ${episode.number}` : 'Episode');
  return episode.variant && !base.toLowerCase().includes(episode.variant.toLowerCase())
    ? `${base} [${episode.variant}]`
    : base;
}

export interface LayoutInput {
  root: string;
  /** Display name of the source, "Example (EN)". */
  source: string;
  anime: string;
  episode: EpisodeNaming;
  kind: 'hls' | 'mp4';
}

/** The final path: a folder for HLS, a file for MP4. */
export function episodePath(input: LayoutInput): string {
  const label = sanitizeName(episodeLabel(input.episode), 'Episode');
  const parent = join(input.root, sanitizeName(input.source, 'Source'), sanitizeName(input.anime, 'Anime'));
  return join(parent, input.kind === 'hls' ? label : `${label}.mp4`);
}

/** Adds " (2)", " (3)"… until `taken` says the path is free (two episodes can share a name). */
export function uniquePath(path: string, taken: (candidate: string) => boolean): string {
  if (!taken(path)) return path;
  const dot = path.endsWith('.mp4') ? path.length - 4 : path.length;
  for (let n = 2; ; n++) {
    const candidate = `${path.slice(0, dot)} (${n})${path.slice(dot)}`;
    if (!taken(candidate)) return candidate;
  }
}

/** Where unfinished data lives: beside the final path, renamed when everything is in (DL-5). */
export const tempPath = (finalPath: string, kind: 'hls' | 'mp4'): string =>
  kind === 'hls' ? `${finalPath}.tmp` : `${finalPath}.part`;
