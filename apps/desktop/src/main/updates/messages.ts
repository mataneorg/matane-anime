import { type Language, languageFromLocale } from '@matane-anime/shared';

export interface NewEpisodesSummary {
  episodes: number;
  anime: number;
  /** Set when every new episode belongs to one anime. */
  title?: string;
}

/**
 * The text of the "new episodes" notification (UPD-7), grouped: one notification per check, not one per episode.
 * TODO: the renderer's i18next catalogs (en.json, id.json) are not reachable from main; these two languages are
 * duplicated here until main gets its own i18n. Keep them in step with `LANGUAGES`.
 */
export function newEpisodesText(summary: NewEpisodesSummary, language: Language): { title: string; body: string } {
  const { episodes, anime, title } = summary;
  if (language === 'id') {
    return {
      title: 'Episode baru',
      body: title ? `${episodes} episode baru dari ${title}` : `${episodes} episode baru dari ${anime} anime`,
    };
  }
  const noun = episodes === 1 ? 'episode' : 'episodes';
  return {
    title: 'New episodes',
    body: title ? `${episodes} new ${noun} of ${title}` : `${episodes} new ${noun} from ${anime} anime`,
  };
}

/** `system` follows the OS locale. */
export function resolveLanguage(setting: 'system' | Language, systemLocale: string): Language {
  return setting === 'system' ? languageFromLocale(systemLocale) : setting;
}
