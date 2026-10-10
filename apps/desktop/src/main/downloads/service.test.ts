import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Stream } from '@matane-anime/extension-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DownloadUpstream } from './fetch';
import { Env, tree, until } from './test-helpers';

// The queue as a state machine, with a fake CDN whose answers the test controls (a latch holds a request
// until released) and a fake clock. Real files and a real database, no network.

const SEGMENT_BYTES = 1000;

class FakeCdn {
  readonly calls: string[] = [];
  private readonly latches = new Map<string, { promise: Promise<void>; release: () => void }>();
  private readonly failures = new Map<string, number>();
  private readonly hits = new Map<string, number>();
  readonly texts = new Map<string, string>();
  now = 1_000_000;
  /** Time that passes for every segment served, for the speed. */
  msPerSegment = 0;

  /** A playlist with `count` 2-second segments (and a master with the given bandwidth, if any). */
  hls(name: string, count: number, bandwidth: number | null = 320_000): string {
    const lines = ['#EXTM3U', '#EXT-X-TARGETDURATION:2', '#EXT-X-MEDIA-SEQUENCE:0'];
    for (let i = 0; i < count; i++) lines.push('#EXTINF:2.0,', `s${i}.ts`);
    lines.push('#EXT-X-ENDLIST');
    this.texts.set(`https://cdn.test/${name}/v/index.m3u8`, lines.join('\n'));
    if (bandwidth === null) return `https://cdn.test/${name}/v/index.m3u8`;
    this.texts.set(
      `https://cdn.test/${name}/master.m3u8`,
      `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=1280x720\nv/index.m3u8\n`,
    );
    return `https://cdn.test/${name}/master.m3u8`;
  }

  live(name: string): string {
    this.texts.set(`https://cdn.test/${name}/live.m3u8`, '#EXTM3U\n#EXTINF:2.0,\ns0.ts\n');
    return `https://cdn.test/${name}/live.m3u8`;
  }

  /** Holds requests whose URL ends with `suffix` until the returned function is called. */
  hold(suffix: string): () => void {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => (release = resolve));
    this.latches.set(suffix, { promise, release });
    return release;
  }

  /** Answers the first `times` requests whose URL ends with `suffix` with `status`. */
  fail(suffix: string, status: number, times = Number.POSITIVE_INFINITY): void {
    this.failures.set(suffix, status);
    this.hits.set(suffix, -times);
  }

  clearFailures(): void {
    this.failures.clear();
  }

  count(suffix: string): number {
    return this.calls.filter((url) => url.endsWith(suffix)).length;
  }

  readonly upstream: DownloadUpstream = async (url, init) => {
    this.calls.push(url);
    for (const [suffix, latch] of this.latches) {
      if (!url.endsWith(suffix)) continue;
      await new Promise<void>((resolve, reject) => {
        if (init.signal?.aborted) return reject(new Error('aborted'));
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        void latch.promise.then(resolve);
      });
    }
    for (const [suffix, status] of this.failures) {
      if (!url.endsWith(suffix)) continue;
      const hit = (this.hits.get(suffix) ?? 0) + 1;
      this.hits.set(suffix, hit);
      if (hit <= 0) return new Response(null, { status });
    }
    const text = this.texts.get(url);
    if (text !== undefined)
      return new Response(text, { headers: { 'content-length': String(Buffer.byteLength(text)) } });
    if (url.endsWith('.ts')) {
      this.now += this.msPerSegment;
      return new Response(Buffer.alloc(SEGMENT_BYTES, 7), { headers: { 'content-length': String(SEGMENT_BYTES) } });
    }
    return new Response(null, { status: 404 });
  };
}

let cdn: FakeCdn;
let env: Env;
let streams: Map<number, () => Stream[]>;

const stream = (url: string): Stream => ({ url, server: 'A', quality: 720 });

async function setup(options: { freeBytes?: number | null } = {}): Promise<void> {
  cdn = new FakeCdn();
  streams = new Map();
  env = await Env.create({
    streamsFor: async (episodeId) => ({ streams: streams.get(episodeId)?.() ?? [], extensionId: 'example' }),
    upstream: cdn.upstream,
    now: () => cdn.now,
    ...(options.freeBytes !== undefined && { freeBytes: async () => options.freeBytes ?? null }),
  });
}
afterEach(() => env?.close());

/** Episodes of one anime, each served by its own HLS of `segments` segments. */
function episodes(title: string, count: number, segments = 3, bandwidth: number | null = 320_000): number[] {
  const ids = env.addEpisodes(title, count);
  ids.forEach((id, i) => {
    const url = cdn.hls(`${title}-${i}`, segments, bandwidth);
    streams.set(id, () => [stream(url)]);
  });
  return ids;
}

const statusOf = (id: number): string | undefined => env.row(id)?.status;

describe('queue order and parallelism (DL-1)', () => {
  beforeEach(() => setup());

  it('runs one episode at a time, in queue order, and starts the next when one finishes', async () => {
    const [a, b, c] = episodes('Order', 3) as [number, number, number];
    const release = cdn.hold('Order-0/v/s1.ts');
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [a, b, c] });
    await until(() => statusOf(a) === 'downloading');
    expect([statusOf(a), statusOf(b), statusOf(c)]).toEqual(['downloading', 'queued', 'queued']);
    release();
    await service.idle();
    expect([statusOf(a), statusOf(b), statusOf(c)]).toEqual(['done', 'done', 'done']);
    const done = cdn.calls.filter((url) => url.endsWith('s0.ts')).map((url) => url.split('/')[3]);
    expect(done).toEqual(['Order-0', 'Order-1', 'Order-2']);
  });

  it('follows a reorder of the waiting ones', async () => {
    const [a, b, c] = episodes('Reorder', 3) as [number, number, number];
    const release = cdn.hold('Reorder-0/v/s1.ts');
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [a, b, c] });
    await until(() => statusOf(a) === 'downloading');
    service.reorder([c, b]);
    release();
    await service.idle();
    const order = cdn.calls.filter((url) => url.endsWith('s0.ts')).map((url) => url.split('/')[3]);
    expect(order).toEqual(['Reorder-0', 'Reorder-2', 'Reorder-1']);
    // The queue slots are only permuted among the ids given.
    const orders = [a, b, c].map((id) => env.row(id)!.queueOrder);
    expect(orders[0]).toBeLessThan(orders[2]!);
    expect(orders[2]).toBeLessThan(orders[1]!);
  });

  it('runs several episodes at once when the setting says so', async () => {
    env.db.settings.updateAppSettings({ downloadParallelEpisodes: 2 });
    const [a, b, c] = episodes('Parallel', 3) as [number, number, number];
    const release = cdn.hold('s1.ts');
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [a, b, c] });
    await until(() => statusOf(a) === 'downloading' && statusOf(b) === 'downloading');
    expect(statusOf(c)).toBe('queued');
    release();
    await service.idle();
    expect(statusOf(c)).toBe('done');
  });

  it('fetches at most the configured number of segments of an episode at once', async () => {
    env.db.settings.updateAppSettings({ downloadParallelSegments: 2 });
    const [a] = episodes('Width', 1, 6) as [number];
    let inFlight = 0;
    let peak = 0;
    const inner = cdn.upstream;
    const counting: DownloadUpstream = async (url, init, source) => {
      if (!url.endsWith('.ts')) return inner(url, init, source);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      try {
        return await inner(url, init, source);
      } finally {
        inFlight--;
      }
    };
    const service = env.service({ upstream: counting });
    service.start();
    await service.enqueue({ episodeIds: [a] });
    await service.idle();
    expect(statusOf(a)).toBe('done');
    expect(peak).toBe(2);
  });

  it('puts a new download at the end, and answers for what is already there', async () => {
    const [a, b] = episodes('Existing', 2) as [number, number];
    const service = env.service();
    expect(await service.enqueue({ episodeIds: [a, b, a] })).toEqual({ queued: [a, b], existing: [], refused: [] });
    expect(await service.enqueue({ episodeIds: [a] })).toEqual({ queued: [], existing: [a], refused: [] });
    expect(env.row(a)!.queueOrder).toBeLessThan(env.row(b)!.queueOrder);
    service.start();
    await service.idle();
    expect(await service.enqueue({ episodeIds: [a] })).toEqual({ queued: [], existing: [a], refused: [] });
  });
});

describe('pause, resume, cancel, remove (DL-8)', () => {
  beforeEach(() => setup());

  it('pauses the running one at once, lets the next take its place, and finishes it after a resume', async () => {
    const [a, b] = episodes('Pause', 2, 4) as [number, number];
    env.db.settings.updateAppSettings({ downloadParallelSegments: 1 });
    const release = cdn.hold('Pause-0/v/s2.ts');
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [a, b] });
    await until(() => statusOf(a) === 'downloading' && cdn.count('Pause-0/v/s2.ts') > 0);
    service.pause(env.row(a)!.id);
    expect(statusOf(a)).toBe('paused');
    await until(() => statusOf(b) === 'done');
    expect(statusOf(a)).toBe('paused');
    expect(env.row(a)!.error).toBeNull();
    // The two segments before the held one are on disk.
    expect(
      readdirSync(`${env.row(a)!.path}.tmp`)
        .filter((n) => n.startsWith('seg_'))
        .sort(),
    ).toEqual(['seg_00000.ts', 'seg_00001.ts']);

    release();
    service.resume(env.row(a)!.id);
    expect(statusOf(a)).toBe('queued');
    await service.idle();
    expect(statusOf(a)).toBe('done');
    expect(cdn.count('Pause-0/v/s0.ts')).toBe(1);
    expect(cdn.count('Pause-0/v/s1.ts')).toBe(1);
  });

  it('pauses and resumes everything', async () => {
    const [a, b, c] = episodes('All', 3) as [number, number, number];
    cdn.hold('All-0/v/s1.ts');
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [a, b, c] });
    await until(() => statusOf(a) === 'downloading');
    service.pauseAll();
    await service.idle();
    expect([a, b, c].map(statusOf)).toEqual(['paused', 'paused', 'paused']);
    // Nothing starts while everything is paused.
    expect(cdn.count('All-1/v/s0.ts')).toBe(0);
    service.resumeAll();
    expect([a, b, c].map(statusOf)).toEqual(['queued', 'queued', 'queued']);
  });

  it('cancels a running download: it stops, its partial files go, and so does its row', async () => {
    const [a, b] = episodes('Cancel', 2) as [number, number];
    cdn.hold('Cancel-0/v/s2.ts');
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [a, b] });
    await until(() => cdn.count('Cancel-0/v/s1.ts') > 0 && existsSync(`${env.row(a)?.path}.tmp`));
    const path = env.row(a)!.path!;
    await service.cancel(env.row(a)!.id);
    expect(env.row(a)).toBeUndefined();
    expect(existsSync(`${path}.tmp`)).toBe(false);
    await until(() => statusOf(b) === 'done');
    // The anime folder is still there for the other episode; its own left-overs are gone.
    expect(readdirSync(join(env.folder, 'Example (EN)', 'Cancel'))).toEqual(['Episode 2']);
  });

  it('removes a finished download with its files, and the empty folders around it', async () => {
    const [a] = episodes('Gone', 1) as [number];
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [a] });
    await service.idle();
    expect(existsSync(env.row(a)!.path!)).toBe(true);
    await service.remove(env.row(a)!.id);
    expect(env.row(a)).toBeUndefined();
    expect(readdirSync(env.folder)).toEqual([]);
  });

  it('does not delete a folder that is not ours', async () => {
    const [a] = episodes('Foreign', 1) as [number];
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [a] });
    await service.idle();
    const path = env.row(a)!.path!;
    // Someone replaced the folder with their own files.
    writeFileSync(join(path, 'playlist.m3u8'), 'x');
    const other = join(env.folder, 'Example (EN)', 'Foreign', 'Mine');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'notes.txt'), 'keep');
    env.db.downloads.update(env.row(a)!.id, { path: other });
    await service.remove(env.row(a)!.id);
    expect(readFileSync(join(other, 'notes.txt'), 'utf8')).toBe('keep');
  });

  it('clears failed downloads and their leftovers', async () => {
    const [a, b] = episodes('Clear', 2) as [number, number];
    cdn.fail('Clear-0/v/s1.ts', 404);
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [a, b] });
    await service.idle();
    expect([statusOf(a), statusOf(b)]).toEqual(['error', 'done']);
    const path = env.row(a)!.path!;
    expect(existsSync(`${path}.tmp`)).toBe(true);
    await service.clearFailed();
    expect(env.row(a)).toBeUndefined();
    expect(statusOf(b)).toBe('done');
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });
});

describe('errors and retry (DL-7)', () => {
  beforeEach(() => setup());

  it('records a refusal by the site as an error, keeps the segments, and retries only the rest', async () => {
    const [a] = episodes('Err', 1, 4) as [number];
    cdn.fail('Err-0/v/s2.ts', 404);
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [a] });
    await service.idle();
    expect(env.row(a)).toMatchObject({ status: 'error', error: 'http_404' });
    const kept = readdirSync(`${env.row(a)!.path}.tmp`).filter((n) => n.startsWith('seg_'));
    expect(kept.length).toBeGreaterThan(0);

    cdn.clearFailures();
    const before = cdn.calls.length;
    service.retry(env.row(a)!.id);
    expect(statusOf(a)).toBe('queued');
    expect(env.row(a)!.error).toBeNull();
    await service.idle();
    expect(statusOf(a)).toBe('done');
    const refetched = cdn.calls.slice(before).filter((url) => url.endsWith('.ts'));
    expect(refetched).toHaveLength(4 - kept.length);
  });

  it('retries a server error three times before it gives up', async () => {
    const [a] = episodes('Flaky', 1, 1) as [number];
    cdn.fail('Flaky-0/v/s0.ts', 503, 3);
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [a] });
    await service.idle();
    expect(statusOf(a)).toBe('done');
    expect(cdn.count('Flaky-0/v/s0.ts')).toBe(4);

    const [b] = episodes('Dead', 1, 1) as [number];
    cdn.fail('Dead-0/v/s0.ts', 503);
    await service.enqueue({ episodeIds: [b] });
    await service.idle();
    expect(env.row(b)).toMatchObject({ status: 'error', error: 'http_503' });
    expect(cdn.count('Dead-0/v/s0.ts')).toBe(4);
  });

  it('starts a finished download whose files vanished from scratch when it is enqueued again', async () => {
    const [a] = episodes('Missing', 1) as [number];
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [a] });
    await service.idle();
    const old = env.row(a)!.path!;
    env.db.downloads.update(env.row(a)!.id, { status: 'error', error: 'file_missing' });
    expect(await service.enqueue({ episodeIds: [a] })).toEqual({ queued: [a], existing: [], refused: [] });
    await service.idle();
    expect(env.row(a)).toMatchObject({ status: 'done', error: null });
    // The old folder is still on disk, so the new path is numbered rather than written over it.
    expect(env.row(a)!.path).not.toBe(old);
    expect(tree(env.row(a)!.path!)).toContain('playlist.m3u8');
  });
});

describe('refusals and limits', () => {
  beforeEach(() => setup());

  it('refuses what has no stream, no extension, or no episode', async () => {
    const [a] = episodes('Refuse', 1) as [number];
    streams.set(a, () => []);
    // The other language of the extension is not loaded.
    const [row] = env.db.anime.upsertSummaries('example/id', [{ url: '/x', title: 'Elsewhere' }]);
    env.db.episodes.sync(row!.id, [{ url: '/x/1', name: 'Episode 1', number: 1 }], 100);
    const unloaded = env.db.episodes.list(row!.id)[0]!.id;
    const service = env.service({
      assertAvailable: (sourceId) => {
        if (sourceId === 'example/id') throw new Error('not loaded');
      },
    });
    const result = await service.enqueue({ episodeIds: [a, unloaded, 99999] });
    expect(result.refused).toEqual([
      { episodeId: a, reason: 'no_stream' },
      { episodeId: unloaded, reason: 'no_extension' },
      { episodeId: 99999, reason: 'no_stream' },
    ]);
    expect(env.row(a)).toBeUndefined();
    expect(env.row(unloaded)).toBeUndefined();
  });

  it('refuses a live stream and an unsupported cipher while enqueueing', async () => {
    const [a, b] = env.addEpisodes('Live', 2) as [number, number];
    streams.set(a, () => [stream(cdn.live('Live'))]);
    cdn.texts.set(
      'https://cdn.test/Cipher/index.m3u8',
      '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="k"\n#EXTINF:2,\ns0.ts\n#EXT-X-ENDLIST\n',
    );
    streams.set(b, () => [stream('https://cdn.test/Cipher/index.m3u8')]);
    const service = env.service();
    const result = await service.enqueue({ episodeIds: [a, b] });
    expect(result.refused).toEqual([
      { episodeId: a, reason: 'live' },
      { episodeId: b, reason: 'no_stream' },
    ]);
  });

  it('uses the next stream when the first one is dead', async () => {
    const [a] = env.addEpisodes('Fallback', 1) as [number];
    const good = cdn.hls('Fallback', 2);
    streams.set(a, () => [stream('https://cdn.test/nothing.m3u8'), { url: good, server: 'B' }]);
    const service = env.service();
    service.start();
    expect((await service.enqueue({ episodeIds: [a] })).queued).toEqual([a]);
    await service.idle();
    expect(env.row(a)).toMatchObject({ status: 'done', server: 'B' });
  });

  it('refuses by the estimate: past the size limit unless a manual download is forced', async () => {
    // 6 seconds at 4 Gbit/s is 3 GB, over the 1 GB limit.
    env.db.settings.updateAppSettings({ downloadSizeLimitGb: 1 });
    const [a, b, c] = episodes('Big', 3, 3, 4_000_000_000) as [number, number, number];
    const service = env.service();
    expect((await service.enqueue({ episodeIds: [a] })).refused).toEqual([{ episodeId: a, reason: 'size_limit' }]);
    expect((await service.enqueue({ episodeIds: [b] }, { reason: 'auto' })).refused).toEqual([
      { episodeId: b, reason: 'size_limit' },
    ]);
    expect((await service.enqueue({ episodeIds: [c], force: true }, { reason: 'ahead' })).refused).toEqual([
      { episodeId: c, reason: 'size_limit' },
    ]);
    expect((await service.enqueue({ episodeIds: [a], force: true })).queued).toEqual([a]);
    expect(env.row(a)!.sizeBytes).toBe(3_000_000_000);
  });

  it('counts the queue against the limit, so a long queue cannot pass it episode by episode', async () => {
    env.db.settings.updateAppSettings({ downloadSizeLimitGb: 1 });
    const [a, b] = episodes('Queue', 2, 3, 1_200_000_000) as [number, number];
    // 6 s at 1.2 Gbit/s is 0.9 GB: one fits, two do not.
    const service = env.service();
    expect((await service.enqueue({ episodeIds: [a] })).queued).toEqual([a]);
    expect((await service.enqueue({ episodeIds: [b] })).refused).toEqual([{ episodeId: b, reason: 'size_limit' }]);
  });

  it('checks the size again when a download starts, for batches too big to look at beforehand', async () => {
    env.db.settings.updateAppSettings({ downloadSizeLimitGb: 1 });
    const ids = episodes('Batch', 4, 3, 4_000_000_000);
    const service = env.service();
    service.start();
    const calls = cdn.calls.length;
    expect((await service.enqueue({ episodeIds: ids })).queued).toEqual(ids);
    expect(cdn.calls.length).toBe(calls);
    await service.idle();
    expect(ids.map((id) => [statusOf(id), env.row(id)!.error])).toEqual(ids.map(() => ['error', 'size_limit']));
    // Retry is the user saying yes.
    env.db.settings.updateAppSettings({ downloadSizeLimitGb: 1 });
    service.retry(env.row(ids[0]!)!.id);
    await service.idle();
    expect(statusOf(ids[0]!)).toBe('done');
  });
});

describe('disk space (DL-9)', () => {
  it('refuses when the estimate is bigger than what is free', async () => {
    await setup({ freeBytes: 100_000 });
    // 6 s at 320 kbit/s is 240 KB.
    const [a] = episodes('Disk', 1) as [number];
    const service = env.service();
    expect((await service.enqueue({ episodeIds: [a] })).refused).toEqual([{ episodeId: a, reason: 'disk_space' }]);
  });

  it('checks again when a download starts, for batches too big to look at beforehand', async () => {
    await setup();
    const ids = episodes('Disks', 4);
    let free = 5 * 1024 ** 3;
    const service = env.service({ freeBytes: async () => free });
    service.start();
    expect((await service.enqueue({ episodeIds: ids })).queued).toEqual(ids);
    free = 1000;
    await service.idle();
    expect(ids.map((id) => env.row(id)!.error)).toEqual(ids.map(() => 'disk_space'));
  });

  it('reports a place it cannot write to as an error to retry', async () => {
    await setup();
    const [a] = episodes('Blocked', 1) as [number];
    // A file where the anime's folder should go.
    mkdirSync(join(env.folder, 'Example (EN)'), { recursive: true });
    writeFileSync(join(env.folder, 'Example (EN)', 'Blocked'), 'in the way');
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [a] });
    await service.idle();
    expect(env.row(a)).toMatchObject({ status: 'error', error: 'write_failed' });
  });
});

describe('progress events', () => {
  beforeEach(() => setup());

  it('are spaced at least 250 ms apart per download, carry speed and ETA, and end with done', async () => {
    cdn.msPerSegment = 100;
    env.db.settings.updateAppSettings({ downloadParallelSegments: 1 });
    const [a] = episodes('Events', 1, 20) as [number];
    const stamps: number[] = [];
    const service = env.service({
      emitProgress: (items) => {
        env.emitted.push(items);
        stamps.push(cdn.now);
      },
    });
    service.start();
    await service.enqueue({ episodeIds: [a] });
    await service.idle();

    const events = env.emitted.flat().filter((e) => e.id === env.row(a)!.id);
    const running = events.filter((e) => e.status === 'downloading');
    expect(running.length).toBeGreaterThan(3);
    expect(running.length).toBeLessThan(20);
    // The clock moves 100 ms per segment, so 250 ms means at least every third segment.
    for (let i = 1; i < stamps.length - 1; i++) expect(stamps[i]! - stamps[i - 1]!).toBeGreaterThanOrEqual(250);
    const last = running[running.length - 1]!;
    expect(last.segmentsTotal).toBe(20);
    expect(last.bytesPerSecond).toBeGreaterThan(0);
    expect(last.etaSeconds).not.toBeNull();
    // 1000 bytes per 100 ms.
    expect(last.bytesPerSecond).toBeCloseTo(10_000, -2);
    expect(events[events.length - 1]).toMatchObject({
      status: 'done',
      segmentsDone: 20,
      bytesDone: expect.any(Number),
    });
    expect(env.row(a)).toMatchObject({ segmentsDone: 20, segmentsTotal: 20 });
    expect(env.row(a)!.bytesDone).toBeGreaterThanOrEqual(20 * SEGMENT_BYTES);
  });

  it('emit the paused state when a download is paused', async () => {
    const [a] = episodes('PauseEvent', 1) as [number];
    cdn.hold('s1.ts');
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [a] });
    await until(() => statusOf(a) === 'downloading');
    service.pause(env.row(a)!.id);
    await service.idle();
    expect(env.emitted.flat().at(-1)).toMatchObject({ status: 'paused' });
  });
});

describe('the download folder (DL-6)', () => {
  beforeEach(() => setup());

  async function downloaded(title: string, count: number) {
    const ids = episodes(title, count);
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: ids });
    await service.idle();
    return { ids, service };
  }

  it('reports the storage page: folder, used, limit, free and counts', async () => {
    const { service, ids } = await downloaded('Storage', 2);
    const storage = await service.storage();
    expect(storage.folder).toBe(env.folder);
    expect(storage.limitBytes).toBe(20 * 1024 ** 3);
    expect(storage.usedBytes).toBe(ids.reduce((sum, id) => sum + env.row(id)!.bytesDone, 0));
    expect(storage.usedBytes).toBeGreaterThan(0);
    expect(storage.freeBytes).toBeGreaterThan(0);
    expect(storage.counts).toEqual({ downloading: 0, queued: 0, paused: 0, error: 0, done: 2 });
  });

  it('moves finished downloads along and rewrites their paths', async () => {
    const { service, ids } = await downloaded('Move', 2);
    const before = ids.map((id) => env.row(id)!.path!);
    const target = join(env.folder, '..', `moved-${Date.now()}`);
    await service.changeFolder(target, true);
    const after = ids.map((id) => env.row(id)!.path!);
    after.forEach((path, i) => {
      expect(path.startsWith(target)).toBe(true);
      expect(path.endsWith(before[i]!.slice(env.folder.length))).toBe(true);
      expect(existsSync(join(path, 'playlist.m3u8'))).toBe(true);
      expect(existsSync(before[i]!)).toBe(false);
    });
    expect(env.db.settings.getAppSettings().downloadFolder).toBe(target);
    expect(readdirSync(env.folder)).toEqual([]);
    // New downloads go to the new folder.
    const [more] = episodes('After', 1) as [number];
    await service.enqueue({ episodeIds: [more] });
    await service.idle();
    expect(env.row(more)!.path!.startsWith(target)).toBe(true);
    env.db.settings.updateAppSettings({ downloadFolder: env.folder });
  });

  it('rewrites each path right after its files moved, not all at the end', async () => {
    const { service, ids } = await downloaded('Each', 2);
    const target = join(env.folder, '..', `each-${Date.now()}`);
    const rewrite = env.db.downloads.rewritePaths.bind(env.db.downloads);
    const seen: { rows: number; existsAtRewrite: boolean }[] = [];
    env.db.downloads.rewritePaths = (updates) => {
      seen.push({ rows: updates.length, existsAtRewrite: updates.every((u) => existsSync(u.path)) });
      rewrite(updates);
    };
    try {
      await service.changeFolder(target, true);
    } finally {
      env.db.downloads.rewritePaths = rewrite;
    }
    expect(seen).toEqual(ids.map(() => ({ rows: 1, existsAtRewrite: true })));
    env.db.settings.updateAppSettings({ downloadFolder: env.folder });
  });

  it('only changes where new ones go when not asked to move', async () => {
    const { service, ids } = await downloaded('Stay', 1);
    const target = join(env.folder, '..', `elsewhere-${Date.now()}`);
    const path = env.row(ids[0]!)!.path;
    await service.changeFolder(target, false);
    expect(env.row(ids[0]!)!.path).toBe(path);
    expect(existsSync(path!)).toBe(true);
    expect(env.db.settings.getAppSettings().downloadFolder).toBe(target);
  });

  it('leaves everything as it was when a move fails half way', async () => {
    const { service, ids } = await downloaded('Atomic', 2);
    const before = ids.map((id) => env.row(id)!.path!);
    const target = join(env.folder, '..', `blocked-${Date.now()}`);
    // The second episode's place is taken by a folder with something in it, which a rename cannot replace.
    const blocker = join(target, before[1]!.slice(env.folder.length + 1));
    mkdirSync(blocker, { recursive: true });
    writeFileSync(join(blocker, 'other.txt'), 'x');
    await expect(service.changeFolder(target, true)).rejects.toThrow(/move/i);
    expect(ids.map((id) => env.row(id)!.path)).toEqual(before);
    before.forEach((path) => expect(existsSync(join(path, 'playlist.m3u8'))).toBe(true));
    expect(env.db.settings.getAppSettings().downloadFolder).toBeNull();
    expect(readFileSync(join(blocker, 'other.txt'), 'utf8')).toBe('x');
  });

  it('refuses a relative path', async () => {
    const service = env.service();
    await expect(service.changeFolder('relative/dir', true)).rejects.toThrow(/absolute/);
  });
});

describe('quitting (DL-5)', () => {
  beforeEach(() => setup());

  it('sends what was running back to the queue at once and touches the database no more', async () => {
    const [a, b] = episodes('Quit', 2) as [number, number];
    const release = cdn.hold('Quit-0/v/s1.ts');
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [a, b] });
    await until(() => statusOf(a) === 'downloading');
    service.shutdown();
    expect([statusOf(a), statusOf(b)]).toEqual(['queued', 'queued']);
    const emitted = env.emitted.length;
    await service.idle();
    expect([statusOf(a), statusOf(b)]).toEqual(['queued', 'queued']);
    expect(env.emitted.length).toBe(emitted);
    // And a new start finishes both.
    release();
    const next = env.service();
    next.start();
    await next.idle();
    expect([statusOf(a), statusOf(b)]).toEqual(['done', 'done']);
  });

  it('waits for the extensions to be ready before it starts anything', async () => {
    const [a] = episodes('Ready', 1) as [number];
    let ready!: () => void;
    const service = env.service({ ready: new Promise<void>((resolve) => (ready = resolve)) });
    service.start();
    await service.enqueue({ episodeIds: [a] });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(statusOf(a)).toBe('queued');
    ready();
    await service.idle();
    expect(statusOf(a)).toBe('done');
  });
});
