import { z } from 'zod';

// Which codecs this machine's Chromium can play, measured once by the renderer (`MediaSource` only exists
// there) and reported to main so playback can rank streams by `CODECS` (docs/PRD.md PLY-12, ADR 0038).

/** One codec family and a type string `MediaSource.isTypeSupported` can answer for it. */
export interface CodecProbe {
  family: string;
  type: string;
}

/** The fixed table the renderer measures. A family that is not here is never judged. */
export const CODEC_PROBES: readonly CodecProbe[] = [
  { family: 'h264', type: 'video/mp4; codecs="avc1.640028"' },
  { family: 'hevc', type: 'video/mp4; codecs="hvc1.1.6.L93.B0"' },
  { family: 'vp9', type: 'video/mp4; codecs="vp09.00.10.08"' },
  { family: 'av1', type: 'video/mp4; codecs="av01.0.05M.08"' },
  { family: 'aac', type: 'audio/mp4; codecs="mp4a.40.2"' },
  { family: 'opus', type: 'audio/mp4; codecs="opus"' },
  { family: 'flac', type: 'audio/mp4; codecs="flac"' },
  { family: 'ac3', type: 'audio/mp4; codecs="ac-3"' },
  { family: 'eac3', type: 'audio/mp4; codecs="ec-3"' },
];

/** Whether each measured family plays. A family that is missing was not measured. */
export const codecSupportSchema = z.record(z.string(), z.boolean());
export type CodecSupport = z.infer<typeof codecSupportSchema>;

/** Asks `isSupported` (`MediaSource.isTypeSupported`) about every entry of the table. */
export function measureCodecSupport(isSupported: (type: string) => boolean): CodecSupport {
  const support: CodecSupport = {};
  for (const { family, type } of CODEC_PROBES) {
    try {
      support[family] = isSupported(type);
    } catch {
      // A family the browser cannot answer for stays unmeasured, which means "do not judge it".
    }
  }
  return support;
}
