import type { PlayerQuality } from '@matane-anime/shared';
import { resolveUri } from '../playback/m3u8';
import { qualityRank } from '../playback/ranking';

// HLS playlists for the downloader (docs/PRD.md DL-3). Pure: text in, a plan out. The parser turns a media
// playlist into the list of files to fetch and a copy of the playlist that refers to those files by relative
// name, so the folder plays from disk on its own. AES keys and init segments are saved as files too; the
// segments stay encrypted and the local playlist keeps its `EXT-X-KEY` lines (the player decrypts them).

export type HlsErrorCode = 'live' | 'unsupported_encryption' | 'invalid_playlist' | 'empty_playlist';

/** A media playlist with more entries than this (about 17 hours at 2 s a segment) is not an episode. */
export const MAX_SEGMENTS = 30_000;

export class HlsError extends Error {
  constructor(
    readonly code: HlsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HlsError';
  }
}

export const LOCAL_PLAYLIST = 'playlist.m3u8';
/** With a separate audio track the entry playlist is a master one, and the video playlist sits beside it. */
export const LOCAL_VIDEO_PLAYLIST = 'video.m3u8';
export const LOCAL_AUDIO_DIR = 'audio';
export const LOCAL_AUDIO_PLAYLIST = `${LOCAL_AUDIO_DIR}/index.m3u8`;

export interface ByteRange {
  offset: number;
  length: number;
}

export interface MasterVariant {
  url: string;
  /** Bits per second; null when the playlist does not say. */
  bandwidth: number | null;
  resolution: string | null;
  height: number | null;
  codecs: string | null;
  audioGroup: string | null;
}

export interface AudioRendition {
  groupId: string;
  name: string;
  language: string | null;
  isDefault: boolean;
  /** Absent when the audio is muxed into the video segments. */
  url: string | null;
}

export interface MasterPlaylist {
  variants: MasterVariant[];
  audio: AudioRendition[];
}

export type ResourceKind = 'segment' | 'init' | 'key';

/** One file of an episode: where it comes from and where it is saved, relative to the episode folder. */
export interface HlsResource {
  kind: ResourceKind;
  url: string;
  byteRange: ByteRange | null;
  file: string;
  /** Seconds; 0 for keys and init segments. */
  duration: number;
}

export interface MediaPlaylist {
  resources: HlsResource[];
  segmentCount: number;
  durationSeconds: number;
  /** The playlist with every URI pointing at its saved file (relative to the playlist), ready to write. */
  localText: string;
}

const ATTRIBUTE = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;

export function parseAttributes(list: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, raw] of list.matchAll(ATTRIBUTE)) {
    const value = raw as string;
    out[name as string] = value.startsWith('"') ? value.slice(1, -1) : value;
  }
  return out;
}

const lines = (text: string): string[] => text.split(/\r?\n/).map((line) => line.trim());

export function isMasterPlaylist(text: string): boolean {
  return text.includes('#EXT-X-STREAM-INF');
}

function requireHeader(text: string): void {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new HlsError('invalid_playlist', 'Not an HLS playlist');
}

function absolute(uri: string, baseUrl: string): string {
  const resolved = resolveUri(uri, baseUrl);
  if (!resolved) throw new HlsError('invalid_playlist', `Unsupported URI in playlist: ${uri.slice(0, 80)}`);
  return resolved;
}

export function parseMaster(text: string, baseUrl: string): MasterPlaylist {
  requireHeader(text);
  const variants: MasterVariant[] = [];
  const audio: AudioRendition[] = [];
  const all = lines(text);
  for (let i = 0; i < all.length; i++) {
    const line = all[i] as string;
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = parseAttributes(line.slice('#EXT-X-MEDIA:'.length));
      if (attrs['TYPE'] !== 'AUDIO') continue;
      audio.push({
        groupId: attrs['GROUP-ID'] ?? '',
        name: attrs['NAME'] ?? '',
        language: attrs['LANGUAGE'] ?? null,
        isDefault: attrs['DEFAULT'] === 'YES',
        url: attrs['URI'] ? absolute(attrs['URI'], baseUrl) : null,
      });
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
      let next = i + 1;
      while (next < all.length && (all[next] === '' || all[next]?.startsWith('#'))) next++;
      const uri = all[next];
      if (uri === undefined) throw new HlsError('invalid_playlist', 'A variant has no URI');
      i = next;
      const resolution = attrs['RESOLUTION'] ?? null;
      const height = resolution ? Number(/x(\d+)$/i.exec(resolution)?.[1]) : NaN;
      variants.push({
        url: absolute(uri, baseUrl),
        bandwidth: Number(attrs['BANDWIDTH']) > 0 ? Number(attrs['BANDWIDTH']) : null,
        resolution,
        height: Number.isFinite(height) && height > 0 ? height : null,
        codecs: attrs['CODECS'] ?? null,
        audioGroup: attrs['AUDIO'] ?? null,
      });
    }
  }
  if (variants.length === 0) throw new HlsError('invalid_playlist', 'The master playlist has no variants');
  return { variants, audio };
}

/**
 * The variant for a quality preference: the nearest height by the player's own ranking (docs/PRD.md STR-1),
 * so "as played" and a fixed height behave the same here as there. Variants of equal height go to the one
 * with more bandwidth; with no heights at all that is the only signal.
 */
export function pickVariant(variants: MasterVariant[], preference: PlayerQuality): MasterVariant {
  const sorted = [...variants].sort(
    (a, b) =>
      qualityRank(a.height ?? undefined, preference) - qualityRank(b.height ?? undefined, preference) ||
      (b.bandwidth ?? 0) - (a.bandwidth ?? 0),
  );
  return sorted[0] as MasterVariant;
}

/**
 * The audio track of a variant that keeps it apart (docs/PRD.md §15.2): the `DEFAULT=YES` rendition of the
 * variant's `AUDIO` group, or the first one of the group. Null when the audio is part of the video.
 */
export function pickAudio(master: MasterPlaylist, variant: MasterVariant): AudioRendition | null {
  if (!variant.audioGroup) return null;
  const group = master.audio.filter((a) => a.groupId === variant.audioGroup && a.url !== null);
  return group.find((a) => a.isDefault) ?? group[0] ?? null;
}

/** Bytes an episode takes, from the stream's bits per second and its length. Null when either is unknown. */
export function estimateBytes(bandwidth: number | null, durationSeconds: number): number | null {
  if (bandwidth === null || !(durationSeconds > 0)) return null;
  return Math.round((bandwidth * durationSeconds) / 8);
}

function extensionOf(url: string, fallback: string): string {
  try {
    const match = /\.([A-Za-z0-9]{1,5})$/.exec(new URL(url).pathname);
    return match ? `.${match[1]?.toLowerCase()}` : fallback;
  } catch {
    return fallback;
  }
}

const URI_ATTRIBUTE = /URI="[^"]*"/;
const rangeKey = (range: ByteRange | null): string => (range ? `${range.offset}+${range.length}` : '');

/**
 * Reads a media playlist. `dir` is where its files live relative to the episode folder (`''`, or `audio`),
 * the playlist itself being written into that same folder. Throws `live` when the playlist has no
 * `EXT-X-ENDLIST`, and `unsupported_encryption` for anything but AES-128 with a plain key file.
 */
export function parseMediaPlaylist(text: string, baseUrl: string, dir = ''): MediaPlaylist {
  requireHeader(text);
  if (isMasterPlaylist(text)) throw new HlsError('invalid_playlist', 'Expected a media playlist, got a master one');

  const resources: HlsResource[] = [];
  const known = new Map<string, HlsResource>();
  const counters = { segment: 0, init: 0, key: 0 };
  const nextEnd = new Map<string, number>();
  const out: string[] = [];
  let duration = 0;
  let pendingDuration = 0;
  let pendingRange: { length: number; offset: number | null } | null = null;
  let ended = false;
  let segmentCount = 0;

  const resource = (
    kind: ResourceKind,
    uri: string,
    range: ByteRange | null,
    seconds: number,
    extension: string,
  ): HlsResource => {
    const url = absolute(uri, baseUrl);
    const id = `${kind}|${url}|${rangeKey(range)}`;
    const existing = known.get(id);
    if (existing) return existing;
    const index = counters[kind]++;
    const name =
      kind === 'segment'
        ? `seg_${String(index).padStart(5, '0')}${extensionOf(url, extension)}`
        : kind === 'init'
          ? `init_${index}${extensionOf(url, '.mp4')}`
          : `key_${index}.key`;
    const created: HlsResource = {
      kind,
      url,
      byteRange: range,
      file: dir ? `${dir}/${name}` : name,
      duration: seconds,
    };
    known.set(id, created);
    resources.push(created);
    return created;
  };
  const local = (r: HlsResource): string => r.file.slice(dir ? dir.length + 1 : 0);

  for (const line of lines(text)) {
    if (line === '') continue;
    if (!line.startsWith('#')) {
      let range: ByteRange | null = null;
      if (pendingRange) {
        const url = absolute(line, baseUrl);
        const offset = pendingRange.offset ?? nextEnd.get(url) ?? 0;
        range = { offset, length: pendingRange.length };
        nextEnd.set(url, offset + range.length);
      }
      out.push(local(resource('segment', line, range, pendingDuration, '.ts')));
      duration += pendingDuration;
      segmentCount++;
      if (segmentCount > MAX_SEGMENTS) throw new HlsError('invalid_playlist', 'The playlist has too many segments');
      pendingDuration = 0;
      pendingRange = null;
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      pendingDuration = Number.parseFloat(line.slice('#EXTINF:'.length)) || 0;
      out.push(line);
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      const [length, offset] = line.slice('#EXT-X-BYTERANGE:'.length).split('@');
      pendingRange = { length: Number(length), offset: offset === undefined ? null : Number(offset) };
      // The pieces become files of their own, so the local playlist needs no ranges.
    } else if (line.startsWith('#EXT-X-ENDLIST')) {
      ended = true;
      out.push(line);
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(line.slice('#EXT-X-KEY:'.length));
      const method = attrs['METHOD'] ?? 'NONE';
      if (method === 'NONE') {
        out.push(line);
        continue;
      }
      if (method !== 'AES-128') throw new HlsError('unsupported_encryption', `Unsupported encryption: ${method}`);
      const format = attrs['KEYFORMAT'] ?? 'identity';
      if (format !== 'identity' || !attrs['URI'])
        throw new HlsError('unsupported_encryption', `Unsupported key format: ${format}`);
      out.push(line.replace(URI_ATTRIBUTE, `URI="${local(resource('key', attrs['URI'], null, 0, '.key'))}"`));
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributes(line.slice('#EXT-X-MAP:'.length));
      if (!attrs['URI']) throw new HlsError('invalid_playlist', 'EXT-X-MAP without a URI');
      const [length, offset] = (attrs['BYTERANGE'] ?? '').split('@');
      const range = length ? { offset: Number(offset ?? 0), length: Number(length) } : null;
      const file = local(resource('init', attrs['URI'], range, 0, '.mp4'));
      out.push(`#EXT-X-MAP:URI="${file}"`);
    } else {
      out.push(line);
    }
  }

  if (!ended) {
    throw new HlsError('live', 'This is a live stream (the playlist has no end), which cannot be downloaded');
  }
  if (segmentCount === 0) throw new HlsError('empty_playlist', 'The playlist has no segments');
  return { resources, segmentCount, durationSeconds: duration, localText: `${out.join('\n')}\n` };
}

/** The entry playlist of an episode with a separate audio track. */
export function buildLocalMaster(variant: MasterVariant, audio: AudioRendition): string {
  const attrs = [`BANDWIDTH=${variant.bandwidth ?? 0}`];
  if (variant.resolution) attrs.push(`RESOLUTION=${variant.resolution}`);
  if (variant.codecs) attrs.push(`CODECS="${variant.codecs}"`);
  attrs.push('AUDIO="audio"');
  const media = [
    'TYPE=AUDIO',
    'GROUP-ID="audio"',
    `NAME="${audio.name.replaceAll('"', "'")}"`,
    ...(audio.language ? [`LANGUAGE="${audio.language}"`] : []),
    'DEFAULT=YES',
    'AUTOSELECT=YES',
    `URI="${LOCAL_AUDIO_PLAYLIST}"`,
  ];
  return `#EXTM3U\n#EXT-X-MEDIA:${media.join(',')}\n#EXT-X-STREAM-INF:${attrs.join(',')}\n${LOCAL_VIDEO_PLAYLIST}\n`;
}
