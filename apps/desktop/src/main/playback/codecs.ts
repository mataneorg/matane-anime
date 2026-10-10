import type { CodecSupport } from '@matane-anime/shared';

// Reading `CODECS` from a master playlist and judging it against what the renderer reported (docs/PRD.md
// PLY-12, ADR 0038). Everything here is pure; it only ever says "unsupported" when it is sure.

const STREAM_INF = /^#EXT-X-STREAM-INF:(.*)$/;
/** `CODECS="a,b"`, not preceded by another attribute name (`SUPPLEMENTAL-CODECS`). */
const CODECS_ATTRIBUTE = /(?:^|,)CODECS="([^"]*)"/;

/**
 * The codec list of every variant of a master playlist, in order. A variant without `CODECS` is an empty list
 * (unknown). A media playlist has no variants, and a variant whose `CODECS` the read cap cut off counts as unknown too.
 */
export function parseVariantCodecs(playlist: string): string[][] {
  const variants: string[][] = [];
  for (const line of playlist.split(/\r?\n/)) {
    const attributes = STREAM_INF.exec(line.trim())?.[1];
    if (attributes === undefined) continue;
    const codecs = CODECS_ATTRIBUTE.exec(attributes)?.[1];
    variants.push(
      (codecs ?? '')
        .split(',')
        .map((codec) => codec.trim())
        .filter(Boolean),
    );
  }
  return variants;
}

/** The family of a codec string (`avc1.640028` → `h264`), or null for one the app does not judge. */
export function codecFamily(codec: string): string | null {
  const [prefix = '', object = ''] = codec.trim().toLowerCase().split('.');
  switch (prefix) {
    case 'avc1':
    case 'avc3':
      return 'h264';
    case 'hvc1':
    case 'hev1':
      return 'hevc';
    case 'vp09':
    case 'vp9':
      return 'vp9';
    case 'av01':
      return 'av1';
    case 'mp4a':
      return object === '40' ? 'aac' : null;
    case 'opus':
    case 'flac':
      return prefix;
    case 'ac-3':
      return 'ac3';
    case 'ec-3':
      return 'eac3';
    default:
      return null;
  }
}

/** A variant plays unless one of its codecs belongs to a measured family that was reported unsupported. */
export function isVariantSupported(codecs: readonly string[], support: CodecSupport): boolean {
  return codecs.every((codec) => {
    const family = codecFamily(codec);
    return family === null || support[family] !== false;
  });
}

/**
 * Whether a stream can be told, before playing it, to have nothing the player can decode: it has variants and
 * every one of them is unsupported. No variants, no `CODECS` or a family that was never measured all count as
 * "maybe", so those streams keep their place.
 */
export function isStreamUnsupported(variants: readonly string[][] | undefined, support: CodecSupport | null): boolean {
  if (!support || !variants || variants.length === 0) return false;
  return variants.every((codecs) => codecs.length > 0 && !isVariantSupported(codecs, support));
}
