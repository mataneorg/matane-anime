import { describe, expect, it } from 'vitest';
import { CODEC_PROBES, measureCodecSupport } from './codecs';

describe('measureCodecSupport', () => {
  it('answers for every family of the table, as the browser does', () => {
    const support = measureCodecSupport((type) => !type.includes('hvc1') && !type.includes('av01'));
    expect(Object.keys(support).sort()).toEqual(CODEC_PROBES.map((probe) => probe.family).sort());
    expect(support).toMatchObject({ h264: true, hevc: false, av1: false, aac: true });
  });

  it('leaves a family unmeasured when the browser throws for it', () => {
    const support = measureCodecSupport((type) => {
      if (type.includes('flac')) throw new Error('nope');
      return true;
    });
    expect('flac' in support).toBe(false);
    expect(support['h264']).toBe(true);
  });

  it('has one family per entry, each with a type string', () => {
    expect(new Set(CODEC_PROBES.map((probe) => probe.family)).size).toBe(CODEC_PROBES.length);
    for (const { type } of CODEC_PROBES) expect(type).toMatch(/^(video|audio)\/mp4; codecs="[^"]+"$/);
  });
});
