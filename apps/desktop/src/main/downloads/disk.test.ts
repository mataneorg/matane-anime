import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_MAX_BYTES,
  GIB,
  UNKNOWN_SIZE_MIN_FREE,
  exceedsLimit,
  freeBytes,
  gbToBytes,
  hasEnoughSpace,
} from './disk';
import { SpeedMeter } from './progress';

describe('free space (DL-9)', () => {
  it('needs the estimate to fit', () => {
    expect(hasEnoughSpace(500, 1000)).toBe(true);
    expect(hasEnoughSpace(1000, 1000)).toBe(true);
    expect(hasEnoughSpace(1001, 1000)).toBe(false);
  });

  it('without an estimate asks for at least 2 GB, and trusts an unknown amount', () => {
    expect(UNKNOWN_SIZE_MIN_FREE).toBe(2 * GIB);
    expect(hasEnoughSpace(null, 2 * GIB)).toBe(true);
    expect(hasEnoughSpace(null, 2 * GIB - 1)).toBe(false);
    expect(hasEnoughSpace(null, null)).toBe(true);
    expect(hasEnoughSpace(10 * GIB, null)).toBe(true);
  });

  it('reads the free space of a folder that does not exist yet from its nearest parent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'matane-disk-'));
    try {
      const free = await freeBytes(join(dir, 'not', 'yet', 'there'));
      expect(free).toBeGreaterThan(0);
      // Other processes write at the same time, so the two reads only agree roughly.
      expect(Math.abs(free! - (await freeBytes(dir))!)).toBeLessThan(GIB);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runaway cap', () => {
  it('gives an estimate three times its size or 256 MiB more, whichever is larger, and never passes the ceiling', async () => {
    const { runawayCap } = await import('./disk');
    const MIB = 1024 ** 2;
    expect(runawayCap(600)).toBe(600 + 256 * MIB);
    expect(runawayCap(500 * MIB)).toBe(1500 * MIB);
    expect(runawayCap(40 * GIB)).toBe(ABSOLUTE_MAX_BYTES);
  });
});

describe('size limit (DL-10)', () => {
  it('compares what is already taken plus the estimate with the limit', () => {
    const limit = gbToBytes(20);
    expect(limit).toBe(20 * GIB);
    expect(exceedsLimit(19 * GIB, 1 * GIB, limit)).toBe(false);
    expect(exceedsLimit(19 * GIB, 1 * GIB + 1, limit)).toBe(true);
  });

  it('with no estimate only a full folder is refused', () => {
    expect(exceedsLimit(20 * GIB - 1, null, 20 * GIB)).toBe(false);
    expect(exceedsLimit(20 * GIB, null, 20 * GIB)).toBe(true);
  });
});

describe('SpeedMeter', () => {
  it('averages over a window and drops old samples', () => {
    const meter = new SpeedMeter(5000);
    meter.sample(0, 0);
    meter.sample(1000, 1000);
    meter.sample(2000, 3000);
    expect(meter.bytesPerSecond(2000)).toBe(1500);
    meter.sample(9000, 3000 + 7000);
    // Only the last window counts now: it started with a sample before the cutoff and moved on.
    expect(meter.bytesPerSecond(9000)).toBeGreaterThan(0);
    meter.sample(10000, 10000 + 100);
    expect(meter.bytesPerSecond(10000)).toBeCloseTo((10100 - 3000) / 8, 0);
  });

  it('reports zero when stalled, and an ETA only when it can', () => {
    const meter = new SpeedMeter(5000);
    expect(meter.bytesPerSecond(0)).toBe(0);
    meter.sample(0, 0);
    meter.sample(1000, 2000);
    expect(meter.etaSeconds(1000, 6000)).toBe(3);
    expect(meter.etaSeconds(1000, null)).toBeNull();
    expect(meter.bytesPerSecond(20_000)).toBe(0);
    expect(meter.etaSeconds(20_000, 6000)).toBeNull();
  });
});
