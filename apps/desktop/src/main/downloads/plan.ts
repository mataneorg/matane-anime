import type { Stream } from '@matane-anime/extension-sdk';
import type { PlayerQuality } from '@matane-anime/shared';
import { guessKind } from '../playback/ranking';
import { DownloadAborted, DownloadFetchError, type FetchSettings, fetchHead, fetchText, probeSize } from './fetch';
import {
  type AudioRendition,
  HlsError,
  type HlsResource,
  LOCAL_AUDIO_DIR,
  LOCAL_PLAYLIST,
  LOCAL_VIDEO_PLAYLIST,
  type MasterVariant,
  buildLocalMaster,
  estimateBytes,
  isMasterPlaylist,
  parseMaster,
  parseMediaPlaylist,
  pickAudio,
  pickVariant,
} from './hls';

// From a stream the extension returned to a list of files to fetch (docs/PRD.md DL-3): which variant, which
// audio track, what it all adds up to. Nothing is written here.

export interface PlanBase {
  extensionId: string;
  stream: Stream;
  /** Height in pixels of what was picked, when known. */
  quality: number | null;
  /** Total size we expect; null when the stream does not let us tell (DL-9). */
  estimateBytes: number | null;
}

export interface HlsPlan extends PlanBase {
  kind: 'hls';
  /** Video then audio files, saved relative to the episode folder. */
  resources: HlsResource[];
  /** Playlists to write once everything is in, relative to the episode folder; the first is the entry. */
  playlists: { file: string; text: string }[];
  segmentCount: number;
  durationSeconds: number;
}

export interface Mp4Plan extends PlanBase {
  kind: 'mp4';
  url: string;
}

export type Plan = HlsPlan | Mp4Plan;

export type PlanFailure = 'live' | 'no_stream' | 'unsupported_encryption' | 'unreachable';

export class PlanError extends Error {
  constructor(
    readonly reason: PlanFailure,
    message: string,
    /** Some stream failed with 403/410, so a fresh `getStreams` may help (R5). */
    readonly expired = false,
  ) {
    super(message);
    this.name = 'PlanError';
  }
}

export interface PlanContext {
  /** Network settings; `headers` come from each stream. */
  fetch: Omit<FetchSettings, 'headers'>;
  preference: PlayerQuality;
  extensionId: string;
}

async function planHls(stream: Stream, context: PlanContext, settings: FetchSettings): Promise<HlsPlan> {
  const entry = await fetchText(settings, stream.url);
  let variant: MasterVariant | null = null;
  let audio: AudioRendition | null = null;
  let videoText = entry.text;
  let videoUrl = entry.url;
  let master = null;
  if (isMasterPlaylist(entry.text)) {
    master = parseMaster(entry.text, entry.url);
    variant = pickVariant(master.variants, context.preference);
    audio = pickAudio(master, variant);
    const media = await fetchText(settings, variant.url);
    videoText = media.text;
    videoUrl = media.url;
  }
  const video = parseMediaPlaylist(videoText, videoUrl);
  const audioPlaylist =
    master && audio?.url
      ? await fetchText(settings, audio.url).then((fetched) =>
          parseMediaPlaylist(fetched.text, fetched.url, LOCAL_AUDIO_DIR),
        )
      : null;

  const playlists =
    variant && audio && audioPlaylist
      ? [
          { file: LOCAL_PLAYLIST, text: buildLocalMaster(variant, audio) },
          { file: LOCAL_VIDEO_PLAYLIST, text: video.localText },
          { file: `${LOCAL_AUDIO_DIR}/index.m3u8`, text: audioPlaylist.localText },
        ]
      : [{ file: LOCAL_PLAYLIST, text: video.localText }];
  const resources = [...video.resources, ...(audioPlaylist?.resources ?? [])];
  return {
    kind: 'hls',
    extensionId: context.extensionId,
    stream,
    quality: variant?.height ?? stream.quality ?? null,
    estimateBytes: estimateBytes(variant?.bandwidth ?? null, video.durationSeconds),
    resources,
    playlists,
    segmentCount: resources.filter((r) => r.kind === 'segment').length,
    durationSeconds: video.durationSeconds,
  };
}

async function planStream(stream: Stream, context: PlanContext): Promise<Plan> {
  const settings: FetchSettings = { ...context.fetch, headers: stream.headers ?? {} };
  let kind = guessKind(stream);
  if (kind === 'auto') {
    const head = await fetchHead(settings, stream.url, 64);
    kind = new TextDecoder().decode(head).trimStart().startsWith('#EXTM3U') ? 'hls' : 'mp4';
  }
  if (kind === 'hls') return planHls(stream, context, settings);
  return {
    kind: 'mp4',
    extensionId: context.extensionId,
    stream,
    quality: stream.quality ?? null,
    estimateBytes: await probeSize(settings, stream.url),
    url: stream.url,
  };
}

/**
 * The first stream (in the caller's order) that can be downloaded. A stream that does not answer is skipped
 * for the next; a live one or one with unsupported encryption is remembered, so the error that is thrown
 * when none works says the most useful thing.
 */
export async function buildPlan(streams: Stream[], context: PlanContext): Promise<Plan> {
  if (streams.length === 0) throw new PlanError('no_stream', 'The source has no streams for this episode');
  let expired = false;
  const failures = new Set<PlanFailure>();
  let message = '';
  for (const stream of streams) {
    try {
      return await planStream(stream, context);
    } catch (error) {
      if (error instanceof DownloadAborted) throw error;
      if (error instanceof HlsError) {
        failures.add(
          error.code === 'live' ? 'live' : error.code === 'unsupported_encryption' ? error.code : 'unreachable',
        );
        message ||= error.message;
      } else if (error instanceof DownloadFetchError) {
        expired ||= error.expired;
        failures.add('unreachable');
        message ||= error.message;
      } else throw error;
    }
  }
  const reason: PlanFailure = failures.has('live')
    ? 'live'
    : failures.has('unsupported_encryption')
      ? 'unsupported_encryption'
      : 'unreachable';
  throw new PlanError(reason, message || 'No server answered', expired);
}
