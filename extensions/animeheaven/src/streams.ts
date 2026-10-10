import '@matane-anime/extension-sdk/globals';
import { type Episode, type Stream, NotFoundError } from '@matane-anime/extension-sdk';
import { assertOk, base } from './site';
import { isEpisodeKey, pickSource } from './text';

// The player page `/gate.php` answers only when the request carries `Cookie: key=<episode key>` (the site's own
// script sets that cookie before following the link). The answer holds `<source src=".../video.mp4?<key>&<token>">`:
// one MP4 file (English-subtitled 1080p release), served with Range support and without a Referer check.

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const key = episode.url.trim();
  if (!isEpisodeKey(key)) throw new NotFoundError(`Not an episode key: ${episode.url}`);
  const url = `${base()}/gate.php`;
  const response = await http.get(url, { headers: { Cookie: `key=${key}` }, throwOnError: false });
  assertOk(response, url);
  const src = pickSource(response.text);
  if (!src) throw new NotFoundError('The player page has no video source');
  return [{ url: src, server: 'AnimeHeaven', quality: 1080, kind: 'mp4' }];
}
