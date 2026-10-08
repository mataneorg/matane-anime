import { describe, expect, it } from 'vitest';
import { readAjaxConfig, resolveIframe } from '../src/streams';
import { cleanTitle, entityPath, episodeName, parseEpisodeDate, parseEpisodeLabel, unpackPacked } from '../src/text';
import { fixture } from './harness';

describe('entityPath', () => {
  it('gives one identity to every spelling of a link', () => {
    const base = 'https://otakudesu.blog';
    const wanted = '/anime/aoashi-s2-sub-indo/';
    expect(entityPath('https://otakudesu.blog/anime/aoashi-s2-sub-indo/', base)).toBe(wanted);
    expect(entityPath('/anime/aoashi-s2-sub-indo', base)).toBe(wanted);
    expect(entityPath('https://otakudesu.io/anime/aoashi-s2-sub-indo/?x=1#top', base)).toBe(wanted);
    expect(entityPath('/genres/action/', base)).toBe('/genres/action/');
  });
});

describe('cleanTitle', () => {
  it('drops the language suffix and the episode range', () => {
    expect(cleanTitle('Ao Ashi Season 2 Subtitle Indonesia')).toBe('Ao Ashi Season 2');
    expect(cleanTitle('Oni no Hanayome (Episode 1 – 12) Subtitle Indonesia')).toBe('Oni no Hanayome');
    expect(cleanTitle('One Punch Man BD (Episode 1 – 12) Subtitle Indonesia + Special')).toBe('One Punch Man BD');
    expect(cleanTitle('Borot  Sub Indo ')).toBe('Borot');
    expect(cleanTitle('No suffix here')).toBe('No suffix here');
  });
});

describe('parseEpisodeDate', () => {
  it('reads Indonesian months as midnight in WIB', () => {
    expect(parseEpisodeDate('20 September,2026')).toBe(Date.UTC(2026, 8, 19, 17));
    expect(parseEpisodeDate('4 Oktober,2026')).toBe(Date.UTC(2026, 9, 3, 17));
    expect(parseEpisodeDate('29 Mei,2020')).toBe(Date.UTC(2020, 4, 28, 17));
  });

  it('gives up quietly on anything else', () => {
    expect(parseEpisodeDate('')).toBeUndefined();
    expect(parseEpisodeDate('3 Smarch,2020')).toBeUndefined();
    expect(parseEpisodeDate('yesterday')).toBeUndefined();
  });
});

describe('parseEpisodeLabel', () => {
  it('reads plain, fractional and zeroth episodes', () => {
    expect(parseEpisodeLabel('Episode 12 (End)')).toEqual({ number: 12 });
    expect(parseEpisodeLabel('Foo Episode 5.5')).toEqual({ number: 5.5 });
    expect(parseEpisodeLabel('One Punch Man Episode 0')).toEqual({ number: 0 });
  });

  it('checks Special first, so a special never takes the place of a regular episode', () => {
    expect(parseEpisodeLabel('Arifureta S2 Special Episode 1')).toEqual({ variant: 'Special' });
    expect(parseEpisodeLabel('One Punch Man Special 6')).toEqual({ variant: 'Special' });
    expect(parseEpisodeLabel('Muv-Luv Special')).toEqual({ variant: 'Special' });
  });

  it('marks a BD release without a number, and leaves the rest alone', () => {
    expect(parseEpisodeLabel('Sword Art Online Movie: Ordinal Scale BD')).toEqual({ variant: 'BD' });
    expect(parseEpisodeLabel('Something else')).toEqual({});
  });
});

describe('episodeName', () => {
  it('keeps what tells the episode apart', () => {
    const title = 'Heroine? Seijo? Iie, All Works Maid desu (Hokori)!';
    expect(episodeName(`${title} Episode 12 (End) Subtitle Indonesia`, title)).toBe('Episode 12 (End)');
    // The link says "S2" where the page says "Season 2": fall back to the tail.
    expect(episodeName('Arifureta S2 Special Episode 1 Subtitle Indonesia', 'Arifureta Season 2')).toBe(
      'Special Episode 1',
    );
    expect(episodeName('Sword Art Online Movie: Ordinal Scale BD Subtitle Indonesia', 'SAO')).toBe('BD');
    expect(episodeName('Whatever it is Subtitle Indonesia', undefined)).toBe('Whatever it is');
  });
});

describe('unpackPacked', () => {
  it('unpacks a VidHide page without running it', () => {
    const code = unpackPacked(fixture('iframe_odvidhide.txt'));
    expect(code).toContain('jwplayer("vplayer").setup');
    expect(code).toMatch(/"hls2":"https:\/\/[^"]+master\.m3u8\?/);
  });

  it('returns null for a page that is not packed', () => {
    expect(unpackPacked('<html>nothing here</html>')).toBeNull();
    expect(unpackPacked("eval(function(p,a,c,k,e,d){}('broken")).toBeNull();
  });

  it('handles escaped quotes in the payload', () => {
    const packed = String.raw`eval(function(p,a,c,k,e,d){}('0 1=\'2\';3(1)',62,4,'var|x|hi|log'.split('|')))`;
    expect(unpackPacked(packed)).toBe("var x='hi';log(x)");
  });
});

describe('readAjaxConfig', () => {
  it('reads both action names from the page script', () => {
    const config = readAjaxConfig(fixture('episode_ongoing.txt'));
    expect(config).toEqual({
      nonceAction: 'aa1208d27f29ca340c92c66d1926f13f',
      embedAction: '2a3505c93b0035d3f455df82bf976b84',
    });
  });

  it('follows the names when the theme changes them', () => {
    const script =
      'data:{action:"11111111111111111111111111111111"} data:{...e,nonce:a,action:"22222222222222222222222222222222"}';
    expect(readAjaxConfig(script)).toEqual({
      nonceAction: '11111111111111111111111111111111',
      embedAction: '22222222222222222222222222222222',
    });
  });

  it('is null when the script is gone', () => {
    expect(readAjaxConfig('<html></html>')).toBeNull();
  });
});

describe('resolveIframe', () => {
  const at = (url: string) => new URL(url);

  it('reads the MP4 constant of the odcdn player', () => {
    const found = resolveIframe(
      at('https://desustream.net/dstream/odcdn/?id=x'),
      fixture('iframe_desustream_odcdn_default.txt'),
    );
    expect(found).toEqual({ url: 'https://cdn.odcloud.net/anime/Otakudesu.io_Aoshi.S2--01_720p.mp4', kind: 'mp4' });
  });

  it('reads the player file of arcg', () => {
    const found = resolveIframe(
      at('https://desustream.net/dstream/arcg/?id=x'),
      fixture('iframe_desustream_arcg_720.txt'),
    );
    expect(found?.kind).toBe('mp4');
    expect(found?.url).toMatch(/^https:\/\/archive\.org\/download\/.+\.mp4$/);
  });

  it('reads the <video> source of ondesu and otakuwatch7, decoding &amp;', () => {
    const a = resolveIframe(
      at('https://desustream.net/dstream/ondesu/new/hd/index.php?id=x'),
      fixture('iframe_desustream_ondesuhd.txt'),
    );
    const b = resolveIframe(
      at('https://desustream.com/dstream/otakuwatch7/new/hd/index.php?id=x'),
      fixture('iframe_desustream_com_otakuwatch7hd.txt'),
    );
    for (const found of [a, b]) {
      expect(found?.kind).toBe('mp4');
      expect(found?.url).toMatch(/^https:\/\/[^/]+\.googlevideo\.com\/videoplayback\?expire=/);
      expect(found?.url).not.toContain('&amp;');
    }
  });

  it('takes the best HLS link of a packed player, and makes a relative one absolute', () => {
    const found = resolveIframe(at('https://odvidhide.com/embed/h57gdpm7axlb'), fixture('iframe_odvidhide.txt'));
    expect(found?.kind).toBe('hls');
    expect(found?.url).toMatch(
      /^https:\/\/VyY3AyGtEHNQnhdR\.acek-cdn\.com\/hls2\/01\/08666\/h57gdpm7axlb_h\/master\.m3u8\?/,
    );
  });

  it('falls back to any media link for a host it has never seen', () => {
    const found = resolveIframe(
      at('https://new-host.example/e/1'),
      '<script>x="https://cdn.example/v/a.m3u8?t=1"</script>',
    );
    expect(found).toEqual({ url: 'https://cdn.example/v/a.m3u8?t=1', kind: 'hls' });
    expect(resolveIframe(at('https://new-host.example/e/1'), '<p>nothing</p>')).toBeNull();
  });
});
