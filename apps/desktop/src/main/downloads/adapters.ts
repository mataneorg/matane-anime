import type { Stream } from '@matane-anime/extension-sdk';
import type { DownloadQuality } from '@matane-anime/shared';
import { AppError } from '@matane-anime/shared';
import type { AnimeRepository } from '../db/repositories/anime';
import type { EpisodesRepository } from '../db/repositories/episodes';
import type { SettingsRepository } from '../db/repositories/settings';
import type { ExtensionService } from '../extensions/service';
import type { UpstreamFetch } from '../playback/proxy';
import { rankStreams } from '../playback/ranking';
import type { DownloadUpstream } from './fetch';

// The two places the engine meets the rest of the app, kept out of the engine so it needs neither Electron nor
// the extension host: where streams come from, and how requests leave.

/** The key playback stores the server that worked last under (`PlaybackService`). */
const lastServerKey = (sourceId: string): string => `playback.lastServer.${sourceId}`;

export interface StreamSourceDeps {
  episodes: Pick<EpisodesRepository, 'get'>;
  anime: Pick<AnimeRepository, 'get' | 'playbackPrefs'>;
  settings: Pick<SettingsRepository, 'getAppSettings' | 'getValue'>;
  extensions: Pick<ExtensionService, 'assertAvailable' | 'streamsFor'>;
}

/**
 * The streams of an episode, best first. `playback` ranks them exactly as the player would (the user's pick
 * for this anime, the player quality, the server that worked last, DL-3); a fixed quality only looks at
 * heights, since a server picked while watching says nothing about what to keep on disk.
 */
export function createStreamSource(deps: StreamSourceDeps) {
  return async (
    episodeId: number,
    fresh: boolean,
    quality: DownloadQuality,
  ): Promise<{ streams: Stream[]; extensionId: string }> => {
    const episode = deps.episodes.get(episodeId);
    const row = episode && deps.anime.get(episode.animeId);
    if (!episode || !row) throw new AppError('not_found', `No episode with id ${episodeId}`);
    deps.extensions.assertAvailable(row.sourceId);
    const streams = await deps.extensions.streamsFor(row, episode, fresh);
    const asPlayed = quality === 'playback';
    const ranked = rankStreams(streams, {
      manual: asPlayed ? deps.anime.playbackPrefs(row) : null,
      qualityPreference: asPlayed ? deps.settings.getAppSettings().playerQuality : quality,
      lastServer: asPlayed ? deps.settings.getValue<string | null>(lastServerKey(row.sourceId), null) : null,
    });
    return { streams: ranked.map((r) => r.stream), extensionId: row.sourceId.split('/')[0] as string };
  };
}

/**
 * Playback's upstream (the extension's session, its media rate limit, the header bridge) used for downloads.
 * It wants a playback session only to read the extension from it.
 */
export function createDownloadUpstream(upstream: UpstreamFetch): DownloadUpstream {
  return (url, init, source) =>
    upstream(url, init, {
      id: 'download',
      entryUrl: url,
      kind: 'file',
      headers: {},
      hostsSeen: new Set(),
      ...(source.extensionId !== undefined && { extensionId: source.extensionId }),
    });
}
