import { z } from 'zod';

// What crosses IPC about playback (docs/PRD.md §6.4, §8.3). The renderer never sees an upstream URL or a
// header: only the `anime://` URL of a session that main made.

export const streamOptionSchema = z.object({
  /** Position in the ranked candidate list; the key for `playback.switchStream`. */
  index: z.number().int(),
  server: z.string(),
  quality: z.number().nullable(),
  kind: z.enum(['hls', 'mp4']),
  status: z.enum(['playing', 'available', 'failed']),
  /** The server that worked last time for this source (STR-1). */
  lastWorked: z.boolean(),
});
export type StreamOption = z.infer<typeof streamOptionSchema>;

export const episodeRefSchema = z.object({ episodeId: z.number().int(), label: z.string() });
export type EpisodeRef = z.infer<typeof episodeRefSchema>;

export const playbackSessionSchema = z.object({
  /** Identifies this playback in later calls; changes when the player is opened again. */
  playbackId: z.string(),
  episodeId: z.number().int(),
  animeId: z.number().int(),
  /** `anime://play/<session>/…` */
  url: z.string(),
  kind: z.enum(['hls', 'mp4']),
  streams: z.array(streamOptionSchema),
  activeIndex: z.number().int(),
  animeTitle: z.string(),
  episodeName: z.string(),
  episodeNumber: z.number().nullable(),
  sourceName: z.string().nullable(),
  next: episodeRefSchema.nullable(),
  previous: episodeRefSchema.nullable(),
});
export type PlaybackSession = z.infer<typeof playbackSessionSchema>;

export const playbackEventSchema = z.discriminatedUnion('type', [
  /** The first frame was painted: remember this server as the one that works. */
  z.object({ type: z.literal('playing') }),
  /** hls.js or `<video>` gave up. `httpStatus` is the status of the request that failed, if known. */
  z.object({ type: z.literal('error'), httpStatus: z.number().int().nullable(), message: z.string() }),
]);
export type PlaybackEvent = z.infer<typeof playbackEventSchema>;

export const playbackUpdateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ok') }),
  /** Main moved to another stream (or a fresh URL of the same one): load `session` and keep the position. */
  z.object({
    type: z.literal('switched'),
    reason: z.enum(['refreshed', 'fallback']),
    session: playbackSessionSchema,
  }),
  /** Every attempt is used up. `tried` are the servers, `message` the last failure. */
  z.object({
    type: z.literal('failed'),
    tried: z.array(z.string()),
    message: z.string(),
    httpStatus: z.number().int().nullable(),
  }),
]);
export type PlaybackUpdate = z.infer<typeof playbackUpdateSchema>;
