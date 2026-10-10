import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 3, milestone 3i: the download benchmark (docs/PRD.md §10.1, §15.2). It times real downloads through
// the real app against a throttled test site: how many segments in parallel stop paying off, whether the media
// token bucket (30 requests a second) gets in the way, whether two episodes at once help, and how main's memory
// behaves while big files stream to disk. The numbers are attached to the report and printed as a table
// (`PERF_OUT=file` also writes it); the assertions are loose because CI machines are slow.

const ROOT = resolve(__dirname, '../../..');
const EXAMPLE = resolve(ROOT, 'extensions/example');
const MB = 1024 * 1024;

test.describe.configure({ mode: 'serial' });

let site: TestSite;
let app: ElectronApplication;
let page: Page;
let folder: string;
let mediaDir: string;

const invoke = <T = unknown>(channel: string, input?: unknown): Promise<T> =>
  page.evaluate(
    ([c, i]) =>
      (window as unknown as { api: { invoke(c: string, i?: unknown): Promise<unknown> } }).api.invoke(c as string, i),
    [channel, input] as const,
  ) as Promise<T>;

interface Row {
  id: number;
  episodeId: number;
  status: string;
  error: string | null;
  bytesDone: number;
  segmentsTotal: number | null;
  createdAt: number;
  completedAt: number | null;
}

async function series(title: string): Promise<number[]> {
  const found = await invoke<{ items: { animeId: number; title: string }[] }>('sources.browse', {
    sourceId: 'example/en',
    kind: 'search',
    page: 1,
    query: title,
  });
  const anime = found.items.find((item) => item.title === title);
  if (!anime) throw new Error(`No anime ${title}`);
  const { episodes } = await invoke<{ episodes: { id: number; number: number }[] }>('anime.refresh', {
    animeId: anime.animeId,
  });
  return episodes.sort((a, b) => a.number - b.number).map((e) => e.id);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Downloads these episodes and returns the time from queueing to the last one finishing, then forgets them. */
async function timed(episodeIds: number[]): Promise<{ ms: number; bytes: number; segments: number }> {
  // Let the media bucket refill, so every run starts from the same place.
  await pause(1200);
  const queued = await invoke<{ queued: number[]; refused: unknown[] }>('downloads.enqueue', { episodeIds });
  expect(queued.queued).toHaveLength(episodeIds.length);
  let rows: Row[] = [];
  await expect
    .poll(
      async () => {
        rows = (await invoke<Row[]>('downloads.list')).filter((row) => episodeIds.includes(row.episodeId));
        const failed = rows.find((row) => row.status === 'error');
        if (failed) throw new Error(`Download failed: ${failed.error}`);
        return rows.length === episodeIds.length && rows.every((row) => row.status === 'done');
      },
      { timeout: 120_000, intervals: [50] },
    )
    .toBe(true);
  const result = {
    ms: Math.max(...rows.map((row) => row.completedAt ?? 0)) - Math.min(...rows.map((row) => row.createdAt)),
    bytes: rows.reduce((sum, row) => sum + row.bytesDone, 0),
    segments: rows.reduce((sum, row) => sum + (row.segmentsTotal ?? 0), 0),
  };
  for (const row of rows) await invoke('downloads.remove', { id: row.id });
  return result;
}

const lines: string[] = [];
function report(text: string): void {
  lines.push(text);
  console.log(text);
}

test.beforeAll(async () => {
  // A copy of the fixtures, so the memory test can grow files without touching the repository.
  mediaDir = mkdtempSync(join(tmpdir(), 'matane-bench-media-'));
  cpSync(resolve(__dirname, 'fixtures/media'), mediaDir, { recursive: true });
  site = await TestSite.start({ mediaDir });
  execFileSync(process.execPath, [resolve(ROOT, 'packages/extension-cli/dist/cli.js'), 'build', EXAMPLE], {
    stdio: 'pipe',
  });
  folder = mkdtempSync(join(tmpdir(), 'matane-bench-'));
  ({ app, page } = await launchApp());
  await page.waitForSelector('nav', { timeout: 30_000 });
  await invoke('extensions.loadDevFolder', { folder: EXAMPLE });
  await invoke('extensions.setPreference', { extensionId: 'example', key: 'baseUrl', value: site.origin });
  await invoke('settings.set', { downloadFolder: folder, downloadSizeLimitGb: 100 });
});
test.afterAll(async () => {
  const text = lines.join('\n');
  test.info().annotations.push({ type: 'performance', description: text });
  if (process.env['PERF_OUT']) writeFileSync(process.env['PERF_OUT'], text);
  await app?.close().catch(() => undefined);
  await site?.close();
  rmSync(folder, { recursive: true, force: true });
  rmSync(mediaDir, { recursive: true, force: true });
});

let longWave: number[];

test('segments in parallel: where the time stops improving (slow CDN, 150 ms latency + 512 KB/s a connection)', async () => {
  test.setTimeout(300_000);
  longWave = await series('Long Wave'); // three episodes of 24 segments of ~32 KB
  await invoke('settings.set', { downloadParallelEpisodes: 1 });
  // Warm-up: the first download pays for loading the extension, the session and the disk caches.
  await timed([longWave[0]!]);

  site.setThrottle({ segmentDelayMs: 150, bytesPerSecond: 512 * 1024 });
  report('\n### Segments in parallel, slow CDN (150 ms latency, 512 KB/s per connection), 3 episodes = 72 segments');
  report('| parallel segments | time (s), mean of 2 | segments/s | MB/s |');
  report('|---|---|---|---|');
  const times = new Map<number, number>();
  for (const parallel of [1, 2, 4, 6, 8, 12]) {
    await invoke('settings.set', { downloadParallelSegments: parallel });
    const runs = [await timed(longWave), await timed(longWave)];
    const ms = (runs[0]!.ms + runs[1]!.ms) / 2;
    times.set(parallel, ms);
    report(
      `| ${parallel} | ${(ms / 1000).toFixed(2)} | ${((runs[0]!.segments * 1000) / ms).toFixed(1)} | ${(runs[0]!.bytes / MB / (ms / 1000)).toFixed(2)} |`,
    );
  }
  site.setThrottle({});
  // More connections must help a latency-bound download a lot, and 6 must already be much faster than 1.
  expect(times.get(6)!).toBeLessThan(times.get(1)! * 0.5);
  expect(times.get(2)!).toBeLessThan(times.get(1)!);
});

test('the media bucket: a fast CDN (10 ms latency, no byte limit) is held to the bucket rate, not the connections', async () => {
  test.setTimeout(300_000);
  site.setThrottle({ segmentDelayMs: 10 });
  report('\n### Fast CDN (10 ms latency), 3 episodes = 72 segments, media bucket DEFAULT_MEDIA_PER_SECOND');
  report('| parallel segments | time (s), mean of 2 | segments/s | requests/s incl. playlists |');
  report('|---|---|---|---|');
  const rates = new Map<number, number>();
  for (const parallel of [1, 2, 6, 12]) {
    await invoke('settings.set', { downloadParallelSegments: parallel });
    const before = site.log.length;
    const runs = [await timed(longWave), await timed(longWave)];
    const requests = (site.log.length - before) / 2;
    const ms = (runs[0]!.ms + runs[1]!.ms) / 2;
    rates.set(parallel, (runs[0]!.segments * 1000) / ms);
    report(
      `| ${parallel} | ${(ms / 1000).toFixed(2)} | ${rates.get(parallel)!.toFixed(1)} | ${((requests * 1000) / ms).toFixed(1)} |`,
    );
  }
  site.setThrottle({});
  // The burst is 30 and ~75 requests need 45 more tokens: no setting can finish in under about 1.5 s, which is
  // 45 segments/s at best. (This pins DEFAULT_MEDIA_PER_SECOND = 30: change both on purpose, from this table.)
  expect(rates.get(12)!).toBeLessThan(120);
});

test('episodes at once: 1 against 2 and 3 on three episodes', async () => {
  test.setTimeout(300_000);
  site.setThrottle({ segmentDelayMs: 150, bytesPerSecond: 512 * 1024 });
  report('\n### Episodes at once, slow CDN, 3 episodes of 24 segments');
  report('| parallel segments | episodes at once | time (s), mean of 2 | segments/s |');
  report('|---|---|---|---|');
  const totals = new Map<string, number>();
  for (const segments of [2, 6]) {
    for (const episodes of [1, 2, 3]) {
      await invoke('settings.set', { downloadParallelSegments: segments, downloadParallelEpisodes: episodes });
      const runs = [await timed(longWave), await timed(longWave)];
      const ms = (runs[0]!.ms + runs[1]!.ms) / 2;
      totals.set(`${segments}x${episodes}`, ms);
      report(
        `| ${segments} | ${episodes} | ${(ms / 1000).toFixed(2)} | ${((runs[0]!.segments * 1000) / ms).toFixed(1)} |`,
      );
    }
  }
  site.setThrottle({});
  await invoke('settings.set', { downloadParallelSegments: 6, downloadParallelEpisodes: 1 });
  // With few segments per episode, a second episode in flight adds connections and finishes sooner.
  expect(totals.get('2x2')!).toBeLessThan(totals.get('2x1')!);
});

interface MemorySample {
  rss: number;
  total: number;
  samples: number;
}

/** Starts sampling main's resident memory, and that of every Electron process, every 50 ms. */
const startSampling = () =>
  app.evaluate(({ app: electronApp }) => {
    const g = globalThis as unknown as { __mem?: { timer: NodeJS.Timeout; rss: number; total: number; n: number } };
    if (g.__mem) clearInterval(g.__mem.timer);
    const state = { timer: undefined as unknown as NodeJS.Timeout, rss: 0, total: 0, n: 0 };
    const sample = (): void => {
      state.rss = Math.max(state.rss, process.memoryUsage().rss);
      const total = electronApp.getAppMetrics().reduce((sum, p) => sum + p.memory.workingSetSize * 1024, 0);
      state.total = Math.max(state.total, total);
      state.n += 1;
    };
    sample();
    state.timer = setInterval(sample, 50);
    g.__mem = state;
  });
const stopSampling = () =>
  app.evaluate((): MemorySample => {
    const g = globalThis as unknown as { __mem: { timer: NodeJS.Timeout; rss: number; total: number; n: number } };
    clearInterval(g.__mem.timer);
    return { rss: g.__mem.rss, total: g.__mem.total, samples: g.__mem.n };
  });
const current = () =>
  app.evaluate(({ app: electronApp }) => ({
    rss: process.memoryUsage().rss,
    total: electronApp.getAppMetrics().reduce((sum, p) => sum + p.memory.workingSetSize * 1024, 0),
  }));

/** Grows a fixture of the test site in place (zeros after the real bytes; a download never looks inside). */
function pad(path: string, bytes: number): void {
  const have = statSync(path).size;
  if (have < bytes) appendFileSync(path, Buffer.alloc(bytes - have));
  else truncateSync(path, bytes);
}

test('memory: big files stream to disk without a spike that grows with their size', async () => {
  test.setTimeout(300_000);
  const longNight = await series('Long Night'); // /media/mp4/long.mp4
  const mp4 = join(mediaDir, 'mp4/long.mp4');
  const original = statSync(mp4).size;
  site.setThrottle({ bytesPerSecond: 32 * MB });
  await invoke('settings.set', { downloadParallelSegments: 6, downloadParallelEpisodes: 1 });

  report('\n### Memory while downloading (32 MB/s, sampled every 50 ms)');
  report(
    '| download | size (MB) | time (s) | main RSS before (MB) | main RSS peak (MB) | main growth (MB) | all processes growth (MB) |',
  );
  report('|---|---|---|---|---|---|---|');
  const growth = new Map<string, number>();
  const run = async (label: string, episodeIds: number[]): Promise<void> => {
    await pause(500);
    const before = await current();
    await startSampling();
    const result = await timed(episodeIds);
    const peak = await stopSampling();
    const mainGrowth = Math.max(0, peak.rss - before.rss) / MB;
    growth.set(label, mainGrowth);
    report(
      `| ${label} | ${(result.bytes / MB).toFixed(1)} | ${(result.ms / 1000).toFixed(2)} | ${(before.rss / MB).toFixed(0)} | ${(peak.rss / MB).toFixed(0)} | ${mainGrowth.toFixed(1)} | ${(Math.max(0, peak.total - before.total) / MB).toFixed(0)} |`,
    );
  };

  // One warm-up of the same shape, so lazy initialisation is not counted as growth.
  await run('mp4 warm-up (0.5 MB)', [longNight[0]!]);
  pad(mp4, 24 * MB);
  await run('mp4 24 MB', [longNight[1]!]);
  pad(mp4, 192 * MB);
  await run('mp4 192 MB', [longNight[2]!]);
  pad(mp4, original);

  // HLS: three episodes of 24 segments, each segment grown to 1.5 MB (36 MB an episode, 108 MB in all).
  const hlsDir = join(mediaDir, 'hls-long');
  for (let i = 0; i < 24; i++) pad(join(hlsDir, `seg_${String(i).padStart(3, '0')}.ts`), 1.5 * MB);
  await run('hls 3 x 36 MB, 6 segments', longWave);
  await invoke('settings.set', { downloadParallelSegments: 16 });
  await run('hls 3 x 36 MB, 16 segments', longWave);
  await invoke('settings.set', { downloadParallelSegments: 6 });
  site.setThrottle({});

  // A buffered 192 MB file would show up as 192 MB or more, and the 108 MB of HLS as 108 MB or more; streaming
  // stays well under that, whatever the size. RSS includes chunks the garbage collector has not freed yet and a
  // shared CI runner moves it by tens of MB between runs (69 MB was seen for the first HLS case), so the HLS bounds
  // sit just under the size of everything downloaded rather than at what a quiet machine measures.
  expect(growth.get('mp4 192 MB')!).toBeLessThan(100);
  expect(growth.get('hls 3 x 36 MB, 6 segments')!).toBeLessThan(85);
  expect(growth.get('hls 3 x 36 MB, 16 segments')!).toBeLessThan(100);
  // ...and does not scale: eight times the bytes must not mean anything like eight times the growth.
  expect(growth.get('mp4 192 MB')!).toBeLessThan(Math.max(40, growth.get('mp4 24 MB')! * 4));
});
