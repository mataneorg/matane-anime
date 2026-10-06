import { z } from 'zod';

/** Bumped only for changes that break existing extensions (docs/PRD.md §7). */
export const API_VERSION = 1;

const sourceSchema = z.object({
  /** Short key, unique in the extension; the source id is `<extension id>/<key>`. */
  key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'source key: lower-case letters, digits and "-"'),
  /** Content language: an ISO 639-1 code, optionally with a region ("pt-BR"), or "multi". */
  lang: z.string().regex(/^(multi|[a-z]{2,3}(-[A-Za-z0-9]+)?)$/, 'source lang: "id", "en", "pt-BR", "multi", …'),
  name: z.string().min(1),
});

export const manifestSchema = z
  .object({
    /** Never changes after release and carries no language: libraries refer to it. */
    id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'id: lower-case letters, digits and "-", starting with a letter'),
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+([-+].+)?$/, 'version must be semver, e.g. 1.0.0'),
    apiVersion: z.number().int().positive(),
    /** Matane Anime refuses anything else, so an extension for another app is not installed by mistake. */
    type: z.literal('anime', { error: 'Matane Anime only runs extensions with type "anime"' }),
    nsfw: z.boolean().default(false),
    /** Requests per second for this extension (default 10). Media requests have their own, looser limit. */
    rateLimit: z.object({ perSecond: z.number().positive().max(100) }).optional(),
    /** Sent instead of the global User-Agent. */
    userAgent: z.string().min(1).optional(),
    sources: z
      .array(sourceSchema)
      .min(1)
      .refine((sources) => new Set(sources.map((source) => source.key)).size === sources.length, {
        error: 'source keys must be unique',
      }),
  })
  .strip();

export type ExtensionManifest = z.infer<typeof manifestSchema>;
