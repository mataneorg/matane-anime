import type {
  AnimeDetails,
  AnimePage,
  AnimeSummary,
  Episode,
  Filter,
  FilterState,
  Preference,
  Stream,
  UrlKind,
} from '@matane-anime/extension-sdk';
import { z } from 'zod';
import { ExtensionRuntimeError } from './errors';
import {
  animeDetailsSchema,
  animePageSchema,
  animeSummarySchema,
  episodeListSchema,
  filterListSchema,
  preferenceListSchema,
  streamListSchema,
} from './results';
import type { CallOptions, ExtensionRuntime } from './runtime';

/**
 * Where a source's calls go. Locally that is an `ExtensionRuntime`; in the app it is the extension host
 * process, so everything is async. Whatever comes back is untrusted and checked by `SourceClient`.
 */
export interface SourceBackend {
  call(sourceKey: string, method: string, args: unknown[], options?: CallOptions): Promise<unknown>;
  supports(sourceKey: string, method: string): Promise<boolean>;
  preferences(): Promise<unknown>;
}

export function runtimeBackend(runtime: ExtensionRuntime): SourceBackend {
  return {
    call: (sourceKey, method, args, options) => runtime.call(sourceKey, method, args, options),
    supports: async (sourceKey, method) => runtime.supports(sourceKey, method),
    preferences: async () => runtime.preferences(),
  };
}

/**
 * One source of a runtime, with every result checked against the contract. The app and the CLI both go
 * through this, so an extension that works in `ma-ext test` works in the app. Pages start at 1.
 */
export class SourceClient {
  constructor(
    readonly backend: SourceBackend,
    readonly sourceKey: string,
  ) {}

  static forRuntime(runtime: ExtensionRuntime, sourceKey: string): SourceClient {
    return new SourceClient(runtimeBackend(runtime), sourceKey);
  }

  supports(method: 'getLatest' | 'getFilters' | 'resolveUrl' | 'getWebUrl' | 'migrateUrl'): Promise<boolean> {
    return this.backend.supports(this.sourceKey, method);
  }

  getPopular(page: number, options?: CallOptions): Promise<AnimePage> {
    return this.checked('getPopular', [page], animePageSchema, options);
  }

  getLatest(page: number, options?: CallOptions): Promise<AnimePage> {
    return this.checked('getLatest', [page], animePageSchema, options);
  }

  search(query: string, page: number, filters: FilterState = {}, options?: CallOptions): Promise<AnimePage> {
    return this.checked('search', [query, page, filters], animePageSchema, options);
  }

  async getFilters(options?: CallOptions): Promise<Filter[]> {
    if (!(await this.supports('getFilters'))) return [];
    return this.checked('getFilters', [], filterListSchema, options);
  }

  getAnimeDetails(anime: AnimeSummary, options?: CallOptions): Promise<AnimeDetails> {
    return this.checked('getAnimeDetails', [anime], animeDetailsSchema, options);
  }

  /** Newest first, as the extension returns them. */
  getEpisodes(anime: AnimeSummary, options?: CallOptions): Promise<Episode[]> {
    return this.checked('getEpisodes', [anime], episodeListSchema, options);
  }

  /** At least one stream: an empty list is `NotFoundError`, as the contract says. */
  async getStreams(episode: Episode, options?: CallOptions): Promise<Stream[]> {
    const streams = await this.checked('getStreams', [episode], streamListSchema, options);
    if (streams.length === 0) {
      throw new ExtensionRuntimeError(
        'extension',
        'The extension returned no streams for this episode',
        'NotFoundError',
      );
    }
    return streams;
  }

  async resolveUrl(url: string, options?: CallOptions): Promise<AnimeSummary | null> {
    if (!(await this.supports('resolveUrl'))) return null;
    const result = await this.backend.call(this.sourceKey, 'resolveUrl', [url], options);
    return result === null ? null : this.parse('resolveUrl', animeSummarySchema, result);
  }

  async getWebUrl(item: AnimeSummary | Episode, options?: CallOptions): Promise<string | null> {
    if (!(await this.supports('getWebUrl'))) return null;
    const result = await this.backend.call(this.sourceKey, 'getWebUrl', [item], options);
    return typeof result === 'string' && /^https?:\/\//i.test(result) ? result : null;
  }

  async migrateUrl(url: string, kind: UrlKind, fromVersion: string, options?: CallOptions): Promise<string | null> {
    if (!(await this.supports('migrateUrl'))) return null;
    const result = await this.backend.call(this.sourceKey, 'migrateUrl', [url, kind, fromVersion], options);
    return typeof result === 'string' && result !== url ? result : null;
  }

  async preferences(): Promise<Preference[]> {
    return this.parse('preferences', preferenceListSchema, await this.backend.preferences());
  }

  private async checked<S extends z.ZodType>(
    method: string,
    args: unknown[],
    schema: S,
    options?: CallOptions,
  ): Promise<z.output<S>> {
    return this.parse(method, schema, await this.backend.call(this.sourceKey, method, args, options));
  }

  private parse<S extends z.ZodType>(method: string, schema: S, value: unknown): z.output<S> {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new ExtensionRuntimeError(
        'invalid_result',
        `${method} returned data that does not match the contract: ${z.prettifyError(result.error)}`,
      );
    }
    return result.data;
  }
}
