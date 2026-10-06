// The extension contract (docs/PRD.md §7). Own model, not compatible with Aniyomi. Names follow Matane's
// manga SDK so authors of manga extensions feel at home. Adding an optional field is backward compatible;
// `apiVersion` only goes up for changes that break extensions.

/**
 * Stable identity chosen by the extension. Usually a path relative to `baseUrl` (so a domain change
 * does not break libraries), but any stable id works (e.g. a site's own UUID).
 */
export type EntityUrl = string;

export interface AnimeSummary {
  url: EntityUrl;
  title: string;
  thumbnailUrl?: string;
}

export type AnimeStatus = 'ongoing' | 'completed' | 'hiatus' | 'cancelled' | 'unknown';
export type AnimeType = 'tv' | 'movie' | 'ova' | 'ona' | 'special';

export interface AnimeDetails extends AnimeSummary {
  /** Used by search, migration and (later) trackers. */
  altTitles?: string[];
  description?: string;
  genres?: string[];
  studio?: string;
  year?: number;
  status: AnimeStatus;
  type?: AnimeType;
}

export interface Episode {
  url: EntityUrl;
  name: string;
  /** May be fractional (12.5). The extension decides between absolute and per-season numbering. */
  number?: number;
  /** "Sub", "Dub", "BD"…: episodes with the same number count as one. */
  variant?: string;
  /** Epoch milliseconds. */
  uploadedAt?: number;
}

export type StreamKind = 'hls' | 'mp4' | 'auto';

export interface Stream {
  /** A direct video URL, already resolved from any embed by the extension. */
  url: string;
  /** Label for the player menu, e.g. "Server A". */
  server: string;
  /** Height in pixels (1080, 720…). Read from the master playlist when missing. */
  quality?: number;
  /** Defaults to `auto` (guessed from the extension and Content-Type). */
  kind?: StreamKind;
  /** Referer, Origin and the like. Added by the app, which does every request. */
  headers?: Record<string, string>;
}

export interface AnimePage {
  items: AnimeSummary[];
  hasNextPage: boolean;
}

// ---------------------------------------------------------------- filters

export interface FilterOption {
  value: string;
  label: string;
}

export type Filter =
  | { type: 'header'; label: string }
  | { type: 'separator' }
  | { type: 'text'; id: string; label: string; placeholder?: string }
  | { type: 'select'; id: string; label: string; options: FilterOption[]; default?: string }
  | { type: 'checkbox'; id: string; label: string; default?: boolean }
  /** include / exclude / ignore */
  | { type: 'tristate'; id: string; label: string }
  | { type: 'sort'; id: string; label: string; options: FilterOption[]; default?: SortValue }
  /** A titled group of checkbox/tristate filters (e.g. genres). Child ids share the flat state. */
  | { type: 'group'; id: string; label: string; filters: Filter[] };

export type TriState = 'include' | 'exclude';
export interface SortValue {
  value: string;
  ascending: boolean;
}
export type FilterValue = string | boolean | TriState | SortValue;
/** Keyed by filter id. Unset filters are simply absent. */
export type FilterState = Record<string, FilterValue>;

// ------------------------------------------------------------ preferences

export type Preference =
  | { type: 'switch'; key: string; label: string; description?: string; default: boolean }
  | { type: 'select'; key: string; label: string; description?: string; options: FilterOption[]; default: string }
  | {
      type: 'multiselect';
      key: string;
      label: string;
      description?: string;
      options: FilterOption[];
      default: string[];
    }
  | { type: 'text'; key: string; label: string; description?: string; default: string };

// ------------------------------------------------------------------ source

export type UrlKind = 'anime' | 'episode';

export interface SourceInfo {
  /** Source key from the manifest, e.g. "en". */
  key: string;
  lang: string;
  name: string;
}

export interface Source {
  baseUrl: string;

  getPopular(page: number): Promise<AnimePage>;
  getLatest?(page: number): Promise<AnimePage>;
  search(query: string, page: number, filters: FilterState): Promise<AnimePage>;
  getFilters?(): Filter[] | Promise<Filter[]>;

  getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails>;
  /** Newest first. */
  getEpisodes(anime: AnimeSummary): Promise<Episode[]>;
  /** At least one stream. The host picks one, probes it and falls back to the next on failure. */
  getStreams(episode: Episode): Promise<Stream[]>;

  /** Maps a pasted web URL to an anime of this source, or null. */
  resolveUrl?(url: string): AnimeSummary | null;
  /** Full URL for "open in browser". Defaults to `baseUrl + url`. */
  getWebUrl?(item: AnimeSummary | Episode): string;
  /**
   * After an update changes how `url` looks, maps a stored url (written by `fromVersion`) to the new
   * form; return null (or the same url) to keep it.
   */
  migrateUrl?(url: EntityUrl, kind: UrlKind, fromVersion: string): EntityUrl | null;
}

export interface ExtensionDefinition {
  createSource(info: SourceInfo): Source;
  /** Extension-wide settings; the host renders the UI and exposes values through `prefs`. */
  preferences?(): Preference[];
}
