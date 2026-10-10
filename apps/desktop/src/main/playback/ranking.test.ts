import type { Stream } from '@matane-anime/extension-sdk';
import { describe, expect, it } from 'vitest';
import { neighbors } from './neighbors';
import { demote, guessKind, qualityRank, rankStreams } from './ranking';

const stream = (server: string, quality?: number, extra: Partial<Stream> = {}): Stream => ({
  url: `https://cdn.test/${server}-${quality ?? 'x'}.m3u8`,
  server,
  ...(quality !== undefined && { quality }),
  ...extra,
});
const order = (streams: Stream[], input: Parameters<typeof rankStreams>[1]) =>
  rankStreams(streams, input).map(({ stream: s }) => `${s.server}${s.quality ? ` ${s.quality}` : ''}`);

describe('qualityRank', () => {
  it('"highest" prefers taller streams and puts unknown heights last', () => {
    const ranks = [1080, 720, 360, undefined].map((q) => qualityRank(q, 'highest'));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('a fixed height prefers the nearest at or below, then the nearest above', () => {
    const picks = [1080, 720, 480, 360, 240].sort((a, b) => qualityRank(a, '480') - qualityRank(b, '480'));
    expect(picks).toEqual([480, 360, 240, 720, 1080]);
    expect([480, 720, 360].sort((a, b) => qualityRank(a, '1080') - qualityRank(b, '1080'))).toEqual([720, 480, 360]);
  });
});

describe('rankStreams (STR-1)', () => {
  const streams = [stream('A', 720), stream('B', 1080), stream('C', 360), stream('D')];

  it('starts with the highest quality by default, extension order breaking ties', () => {
    expect(order(streams, { qualityPreference: 'highest' })).toEqual(['B 1080', 'A 720', 'C 360', 'D']);
    expect(order([stream('A', 720), stream('B', 720)], { qualityPreference: 'highest' })).toEqual(['A 720', 'B 720']);
  });

  it('follows a fixed quality preference', () => {
    expect(order(streams, { qualityPreference: '720' })).toEqual(['A 720', 'C 360', 'B 1080', 'D']);
  });

  it('puts the manual choice for this anime before everything', () => {
    expect(order(streams, { qualityPreference: 'highest', manual: { server: 'C' } })[0]).toBe('C 360');
    // A manual quality narrows it to that stream.
    const two = [stream('A', 1080), stream('A', 720), stream('B', 1080)];
    expect(order(two, { qualityPreference: 'highest', manual: { server: 'A', quality: 720 } })[0]).toBe('A 720');
  });

  it('prefers the server that worked last only among equals in quality', () => {
    const equal = [stream('A', 720), stream('B', 720)];
    expect(order(equal, { qualityPreference: 'highest', lastServer: 'B' })).toEqual(['B 720', 'A 720']);
    // Quality still wins over the last working server.
    expect(order([stream('A', 1080), stream('B', 720)], { qualityPreference: 'highest', lastServer: 'B' })[0]).toBe(
      'A 1080',
    );
  });

  it('keeps every stream and ignores a manual pick that no longer exists', () => {
    expect(rankStreams(streams, { qualityPreference: 'highest', manual: { server: 'gone' } })).toHaveLength(4);
    expect(order(streams, { qualityPreference: 'highest', manual: { server: 'gone' } })[0]).toBe('B 1080');
  });

  it('reports each stream with its original position', () => {
    expect(rankStreams(streams, { qualityPreference: 'highest' }).map((r) => r.originalIndex)).toEqual([1, 0, 2, 3]);
  });
});

describe('guessKind', () => {
  it('trusts the extension, then the URL', () => {
    expect(guessKind(stream('A', 1, { kind: 'mp4', url: 'https://x/y.m3u8' }))).toBe('mp4');
    expect(guessKind(stream('A', 1, { url: 'https://x/path/master.m3u8?token=1' }))).toBe('hls');
    expect(guessKind(stream('A', 1, { url: 'https://x/video.MP4' }))).toBe('mp4');
    expect(guessKind(stream('A', 1, { url: 'https://x/play?id=3', kind: 'auto' }))).toBe('auto');
  });
});

describe('neighbors', () => {
  const ep = (id: number, number: number | null, variant: string | null, sourceOrder: number) => ({
    id,
    number,
    variant,
    sourceOrder,
  });
  // Newest first, as a source lists them; Sub and Dub of each number.
  const list = [
    ep(1, 3, 'Sub', 0),
    ep(2, 3, 'Dub', 1),
    ep(3, 2, 'Sub', 2),
    ep(4, 2, 'Dub', 3),
    ep(5, 1, 'Sub', 4),
    ep(6, 1, 'Dub', 5),
  ];

  it('walks forward and back by number within a variant', () => {
    expect(neighbors(list, 5)).toMatchObject({ next: { id: 3 }, previous: null });
    expect(neighbors(list, 3)).toMatchObject({ next: { id: 1 }, previous: { id: 5 } });
    expect(neighbors(list, 1)).toMatchObject({ next: null, previous: { id: 3 } });
  });

  it('never flips to another variant', () => {
    expect(neighbors(list, 4)).toMatchObject({ next: { id: 2 }, previous: { id: 6 } });
  });

  it('falls back to the source order for episodes without a number, and handles unknown ids', () => {
    const unnumbered = [ep(10, null, null, 0), ep(11, null, null, 1), ep(12, null, null, 2)];
    expect(neighbors(unnumbered, 11)).toMatchObject({ next: { id: 10 }, previous: { id: 12 } });
    expect(neighbors(list, 999)).toEqual({ next: null, previous: null });
  });
});

describe('demote (PLY-12)', () => {
  it('moves the demoted items to the end and keeps the order inside both groups', () => {
    expect(demote([1, 2, 3, 4, 5], (n) => n % 2 === 0)).toEqual([1, 3, 5, 2, 4]);
  });

  it('drops nothing, and changes nothing when nothing is demoted or everything is', () => {
    expect(demote([1, 2, 3], () => false)).toEqual([1, 2, 3]);
    expect(demote([1, 2, 3], () => true)).toEqual([1, 2, 3]);
    expect(demote([], () => true)).toEqual([]);
  });
});
