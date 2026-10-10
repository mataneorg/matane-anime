import { type Language, languageFromLocale } from '@matane-anime/shared';
import { mainT } from '../i18n';

export interface NewEpisodesSummary {
  episodes: number;
  anime: number;
  /** Set when every new episode belongs to one anime. */
  title?: string;
}

/** The text of the "new episodes" notification (UPD-7), grouped: one notification per check, not one per episode. */
export function newEpisodesText(summary: NewEpisodesSummary, language: Language): { title: string; body: string } {
  const { episodes, anime, title } = summary;
  return {
    title: mainT(language, 'notify.newEpisodes.title'),
    body: title
      ? mainT(language, 'notify.newEpisodes.ofAnime', { count: episodes, title })
      : mainT(language, 'notify.newEpisodes.fromMany', { count: episodes, anime }),
  };
}

/** `system` follows the OS locale. */
export function resolveLanguage(setting: 'system' | Language, systemLocale: string): Language {
  return setting === 'system' ? languageFromLocale(systemLocale) : setting;
}
