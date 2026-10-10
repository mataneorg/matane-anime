import '@matane-anime/extension-sdk/globals';
import { type Episode, type Stream, NotFoundError, ParseError } from '@matane-anime/extension-sdk';
import { base, fetchPage } from './site';
import { readPlayer } from './text';

// An episode page embeds its player as `vidstackPlayer(JSON.parse('{src, subtitles, fonts…}'))`. `src` is an HLS
// master on the site's CDN: no Referer or Origin is needed. It carries 360/720/1080 variants (AES-128 with an open
// key, which any HLS player handles) and, besides the Japanese audio, the dubs of some titles as extra audio groups
// (not selectable through the SDK: the default, Japanese, plays). The subtitles are soft side files (.ass or
// .srt); the SDK has no subtitle field, so they cannot be shown.

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const page = (await fetchPage(`${base()}${episode.url}`)).text;
  const player = readPlayer(page);
  if (!player) {
    if (/vidstackPlayer/.test(page)) throw new ParseError('The player data could not be read: the site changed');
    throw new NotFoundError('This episode has no video yet');
  }
  const src = player.src;
  if (!src || !/^https:\/\//.test(src) || !/\.m3u8(?:$|\?)/.test(src))
    throw new ParseError('The player has no HLS playlist');
  return [{ url: src, server: 'AniZone', kind: 'hls' }];
}
