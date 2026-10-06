import type {
  AnimeDetails,
  AnimePage,
  Episode,
  Filter,
  Preference,
  AnimeSummary,
  Stream,
} from '@matane-anime/extension-sdk';
import { z } from 'zod';

// What an extension returns is untrusted: it is checked, bounded and normalized here, once, before any
// other code sees it (docs/PRD.md §7). `null` is accepted wherever a field is optional, because JSON has
// no `undefined`.

const text = (max: number) => z.string().max(max);
const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined) as z.ZodType<z.infer<T> | undefined>;
const url = text(2048).min(1);
const httpUrl = url.refine((value) => /^https?:\/\//i.test(value), { error: 'must be an http or https URL' });

export const animeSummarySchema = z.object({
  url,
  title: text(500).min(1),
  thumbnailUrl: optional(text(2048)),
});

export const animePageSchema = z.object({
  items: z.array(animeSummarySchema).max(500),
  hasNextPage: z.boolean(),
});

export const animeDetailsSchema = animeSummarySchema.extend({
  altTitles: optional(z.array(text(500)).max(50)),
  description: optional(text(20_000)),
  genres: optional(z.array(text(100)).max(50)),
  studio: optional(text(200)),
  year: optional(z.number().int().min(1900).max(2200)),
  status: z
    .enum(['ongoing', 'completed', 'hiatus', 'cancelled', 'unknown'])
    .nullish()
    .transform((value) => value ?? 'unknown'),
  type: optional(z.enum(['tv', 'movie', 'ova', 'ona', 'special'])),
});

export const episodeSchema = z.object({
  url,
  name: text(500),
  number: optional(z.number().finite()),
  variant: optional(text(50)),
  uploadedAt: optional(z.number().int().nonnegative()),
});
export const episodeListSchema = z.array(episodeSchema).max(20_000);

/** Headers an extension may ask the host to send. Hop-by-hop and framing headers are not its business. */
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'cookie']);
const headersSchema = z
  .record(z.string().max(100), text(2048))
  .refine((headers) => Object.keys(headers).length <= 20, { error: 'at most 20 headers' })
  .transform((headers) =>
    Object.fromEntries(Object.entries(headers).filter(([name]) => !FORBIDDEN_HEADERS.has(name.toLowerCase()))),
  );

export const streamSchema = z.object({
  url: httpUrl,
  server: text(100).min(1),
  quality: optional(z.number().int().positive().max(10_000)),
  kind: optional(z.enum(['hls', 'mp4', 'auto'])),
  headers: optional(headersSchema),
});
export const streamListSchema = z.array(streamSchema).max(100);

const option = z.object({ value: text(200), label: text(200) });
const sortValue = z.object({ value: text(200), ascending: z.boolean() });

export const filterSchema: z.ZodType<Filter> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('header'), label: text(200) }),
    z.object({ type: z.literal('separator') }),
    z.object({ type: z.literal('text'), id: text(100), label: text(200), placeholder: optional(text(200)) }),
    z.object({
      type: z.literal('select'),
      id: text(100),
      label: text(200),
      options: z.array(option).max(200),
      default: optional(text(200)),
    }),
    z.object({ type: z.literal('checkbox'), id: text(100), label: text(200), default: optional(z.boolean()) }),
    z.object({ type: z.literal('tristate'), id: text(100), label: text(200) }),
    z.object({
      type: z.literal('sort'),
      id: text(100),
      label: text(200),
      options: z.array(option).max(50),
      default: optional(sortValue),
    }),
    z.object({ type: z.literal('group'), id: text(100), label: text(200), filters: z.array(filterSchema).max(200) }),
  ]),
) as z.ZodType<Filter>;
export const filterListSchema = z.array(filterSchema).max(100);

export const preferenceSchema: z.ZodType<Preference> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('switch'),
    key: text(100),
    label: text(200),
    description: optional(text(500)),
    default: z.boolean(),
  }),
  z.object({
    type: z.literal('select'),
    key: text(100),
    label: text(200),
    description: optional(text(500)),
    options: z.array(option).max(100),
    default: text(200),
  }),
  z.object({
    type: z.literal('multiselect'),
    key: text(100),
    label: text(200),
    description: optional(text(500)),
    options: z.array(option).max(100),
    default: z.array(text(200)),
  }),
  z.object({
    type: z.literal('text'),
    key: text(100),
    label: text(200),
    description: optional(text(500)),
    default: text(2000),
  }),
]) as z.ZodType<Preference>;
export const preferenceListSchema = z.array(preferenceSchema).max(50);

// Compile-time proof that the schemas produce what the SDK promises.
type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
export type _Checks = [
  Assert<Extends<z.output<typeof animeSummarySchema>, AnimeSummary>>,
  Assert<Extends<z.output<typeof animePageSchema>, AnimePage>>,
  Assert<Extends<z.output<typeof animeDetailsSchema>, AnimeDetails>>,
  Assert<Extends<z.output<typeof episodeSchema>, Episode>>,
  Assert<Extends<z.output<typeof streamSchema>, Stream>>,
];
