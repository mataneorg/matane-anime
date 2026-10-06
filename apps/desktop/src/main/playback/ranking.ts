import type { Stream } from '@matane-anime/extension-sdk';
import type { PlayerQuality } from '@matane-anime/shared';

export interface ManualPick {
  server?: string;
  quality?: number | null;
}

export interface RankingInput {
  /** What the user last chose by hand for this anime (STR-5). Only manual choices count. */
  manual?: ManualPick | null;
  qualityPreference: PlayerQuality;
  /** The server that worked last for this source. */
  lastServer?: string | null;
}

export interface Ranked {
  stream: Stream;
  /** Position in the extension's list, which breaks every remaining tie. */
  originalIndex: number;
}

const UNKNOWN = 1_000_000;

/**
 * How good a height is for a preference. Lower is better. "Highest" prefers taller streams; a fixed height
 * prefers the nearest at or below it, then the nearest above (docs/PRD.md STR-1). Unknown heights go last.
 */
export function qualityRank(quality: number | undefined, preference: PlayerQuality): number {
  if (quality === undefined) return UNKNOWN;
  if (preference === 'highest') return 10_000 - quality;
  const target = Number(preference);
  return quality <= target ? target - quality : 1000 + (quality - target);
}

function matchesManual(stream: Stream, manual: ManualPick | null | undefined): boolean {
  if (!manual?.server || stream.server !== manual.server) return false;
  return manual.quality == null || manual.quality === stream.quality;
}

/**
 * The order in which streams are tried (docs/PRD.md STR-1): (1) the user's manual choice for this anime,
 * (2) the quality preference, (3) the server that worked last for this source, (4) the extension's order.
 */
export function rankStreams(streams: Stream[], input: RankingInput): Ranked[] {
  const keyed = streams.map((stream, originalIndex) => ({
    stream,
    originalIndex,
    key: [
      matchesManual(stream, input.manual) ? 0 : 1,
      qualityRank(stream.quality, input.qualityPreference),
      input.lastServer && stream.server === input.lastServer ? 0 : 1,
      originalIndex,
    ] as const,
  }));
  keyed.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) {
      const difference = (a.key[i] as number) - (b.key[i] as number);
      if (difference !== 0) return difference;
    }
    return 0;
  });
  return keyed.map(({ stream, originalIndex }) => ({ stream, originalIndex }));
}

/** What a stream URL is, when the extension did not say: a playlist, or a file the `<video>` plays itself. */
export function guessKind(stream: Stream): 'hls' | 'mp4' | 'auto' {
  if (stream.kind === 'hls' || stream.kind === 'mp4') return stream.kind;
  const path = (() => {
    try {
      return new URL(stream.url).pathname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (path.endsWith('.m3u8')) return 'hls';
  if (/\.(mp4|m4v|webm|mkv|mov)$/.test(path)) return 'mp4';
  return 'auto';
}
