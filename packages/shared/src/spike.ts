import { z } from 'zod';

// Shapes used by the playback spike (docs/PRD.md R1, docs/adr/0008-media-transport.md).

export const spikeFixtureSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** `transport` fixtures must play; `codec` fixtures are recorded, not asserted. */
  group: z.enum(['transport', 'codec']),
  kind: z.enum(['hls', 'file']),
  container: z.string(),
  /** RFC 6381 codecs string used for `canPlayType` / `MediaSource.isTypeSupported`. */
  codecs: z.string(),
  /** What the spec expects: play normally, only record the outcome, or fail with a 403. */
  expect: z.enum(['play', 'record', 'expire']),
});
export type SpikeFixture = z.infer<typeof spikeFixtureSchema>;

export const spikeStartResultSchema = z.object({
  sessionId: z.string(),
  /** What the renderer gives to hls.js or to `<video src>`. */
  url: z.string(),
  kind: z.enum(['hls', 'file']),
  /** The same media on the fake site, for proving that the renderer cannot fetch it directly. */
  directUrl: z.string(),
  /** An `anime://` URL for a host that never appears in the session's manifests; the proxy must refuse it. */
  forbiddenUrl: z.string(),
});
export type SpikeStartResult = z.infer<typeof spikeStartResultSchema>;

export const spikeRequestLogSchema = z.object({
  host: z.string(),
  path: z.string(),
  status: z.number().int(),
  range: z.string().nullable(),
  referer: z.string().nullable(),
  origin: z.string().nullable(),
});
export type SpikeRequestLog = z.infer<typeof spikeRequestLogSchema>;

export const spikeResultSchema = z.object({
  id: z.string(),
  /** The clock moved past 1 s. For a video that is not enough: see `videoDecoded`. */
  played: z.boolean(),
  /** Frames were decoded and painted. Null for audio-only fixtures. HEVC can play its audio without this. */
  videoDecoded: z.boolean().nullable(),
  canPlayType: z.string(),
  mseSupported: z.boolean().nullable(),
  ttffMs: z.number().nullable(),
  seekMs: z.number().nullable(),
  error: z.string().nullable(),
  errorCode: z.string().nullable(),
  notes: z.array(z.string()),
});
export type SpikeResult = z.infer<typeof spikeResultSchema>;
