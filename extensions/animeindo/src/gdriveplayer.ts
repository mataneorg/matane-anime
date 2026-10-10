import '@matane-anime/extension-sdk/globals';

// gdriveplayer.to/embed2.php: the page holds one inline loader, `var k="gdp…",b=atob("…")`, which XORs the base64
// text with `k` and evaluates the result. The result is read here without being evaluated: it names an HLS
// playlist, `HLS="hlsplaylist.php?s=…&idhls=….m3u8"`, on the same site.

/** The playlist address in an embed page, or undefined when the page has no loader. */
export function readGdriveplayerPlaylist(page: string, origin: string): string | undefined {
  const match = /var k="([^"]+)",b=atob\("([^"]+)"\)/.exec(page);
  if (!match) return undefined;
  const key = match[1] as string;
  const raw = base64.decodeBytes((match[2] as string).replace(/\\\//g, '/'));
  let text = '';
  for (let i = 0; i < raw.length; i++) text += String.fromCharCode((raw[i] as number) ^ key.charCodeAt(i % key.length));
  const playlist = /HLS="([^"]+)"/.exec(text)?.[1];
  return playlist ? new URL(playlist.replace(/^\/+/, ''), `${origin}/`).href : undefined;
}
