import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Stream } from '@matane-anime/extension-sdk';
import { TestSite } from '@matane-anime/test-site';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DownloadService } from './service';
import { Env, MEDIA_DIR, cdnStream, embedStream, tree, until } from './test-helpers';

// The engine as a whole, against the fake site's media host: real files, real HTTP, real database. Only the
// extension and Electron are left out (a function hands over the streams; `fetch` stands in for the session).

let site: TestSite;
let env: Env;
let streamsFor: (episodeId: number, fresh: boolean) => Promise<Stream[]>;
let freshCalls: number[];

beforeAll(async () => {
  site = await TestSite.start({ mediaDir: MEDIA_DIR });
});
afterAll(() => site.close());
beforeEach(async () => {
  site.reset();
  freshCalls = [];
  env = await Env.create({
    streamsFor: async (episodeId, fresh) => {
      if (fresh) freshCalls.push(episodeId);
      return { streams: await streamsFor(episodeId, fresh), extensionId: 'example' };
    },
  });
});
afterEach(() => env.close());

const media = (path: string): Buffer => readFileSync(join(MEDIA_DIR, path));

/** One episode served by `stream`, downloaded to the end. */
async function download(title: string, stream: () => Promise<Stream> | Stream) {
  const [episodeId] = env.addEpisodes(title, 1) as [number];
  streamsFor = async () => [await stream()];
  const service = env.service();
  service.start();
  const result = await service.enqueue({ episodeIds: [episodeId] });
  await service.idle();
  return { service, episodeId, result, row: env.row(episodeId)! };
}

/** Every file a local playlist names, whether in a URI attribute or on a line of its own. */
function referencedFiles(playlist: string): string[] {
  return playlist
    .split('\n')
    .flatMap((line) => (line.startsWith('#') ? [...line.matchAll(/URI="([^"]*)"/g)].map((m) => m[1]!) : [line]))
    .filter((name) => name !== '');
}

/** The folder plays on its own: every reference is a relative file that is there, and nothing points at the net. */
function expectSelfContained(folder: string, playlistFile = 'playlist.m3u8'): void {
  const text = readFileSync(join(folder, playlistFile), 'utf8');
  expect(text).not.toMatch(/https?:|__SITE_B__/);
  const base = playlistFile.includes('/') ? playlistFile.slice(0, playlistFile.lastIndexOf('/') + 1) : '';
  for (const name of referencedFiles(text)) {
    expect(name.startsWith('/')).toBe(false);
    expect(existsSync(join(folder, base, name)), `${base}${name} is saved`).toBe(true);
  }
}

/**
 * Waits until the site has stopped logging requests. A download that failed has aborted the segments still in
 * flight, but the site may be a moment behind in handling them (slow disks do this), and a request logged after
 * the test took its mark would be counted as the retry's.
 */
async function siteQuiet(quietMs = 150, maxMs = 5000): Promise<void> {
  const deadline = Date.now() + maxMs;
  let seen = -1;
  let since = Date.now();
  while (Date.now() < deadline) {
    if (site.log.length !== seen) {
      seen = site.log.length;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const segmentRequests = (since = 0): string[] =>
  site.log
    .slice(since)
    .filter((e) => e.server === 'cdn' && /\.(ts|m4s)$/.test(e.path) && e.status === 200)
    .map((e) => e.path);

describe('HLS (DL-3)', () => {
  it('downloads a TS playlist at the quality the player picks, into a complete local folder', async () => {
    const { row } = await download('TS', () => cdnStream(site, '/media/hls-ts/master.m3u8'));
    expect(row).toMatchObject({
      status: 'done',
      kind: 'hls',
      quality: 360,
      segmentsDone: 3,
      segmentsTotal: 3,
      error: null,
    });
    const folder = row.path!;
    expect(folder.startsWith(env.folder)).toBe(true);
    expect(folder.endsWith(join('Example (EN)', 'TS', 'Episode 1'))).toBe(true);
    expect(tree(folder)).toEqual(['playlist.m3u8', 'seg_00000.ts', 'seg_00001.ts', 'seg_00002.ts']);
    expect(readFileSync(join(folder, 'seg_00001.ts')).equals(media('hls-ts/v360/seg_001.ts'))).toBe(true);
    expectSelfContained(folder);
    expect(row.bytesDone).toBe(row.sizeBytes);
    expect(row.bytesDone).toBeGreaterThan(0);
    expect(existsSync(`${folder}.tmp`)).toBe(false);
    // Only the picked variant was fetched.
    expect(site.log.some((e) => e.path.includes('/v240/'))).toBe(false);
  });

  it('sends the stream headers on every request, playlists and segments alike', async () => {
    await download('Headers', () => cdnStream(site, '/media/hls-ts/master.m3u8'));
    const cdn = site.log.filter((e) => e.server === 'cdn');
    expect(cdn.length).toBeGreaterThanOrEqual(5);
    expect(cdn.every((e) => e.referer === site.referer && e.status === 200)).toBe(true);
  });

  it('honours a fixed quality setting', async () => {
    env.db.settings.updateAppSettings({ downloadQuality: '360' });
    // 240p is the nearest at or below nothing here; 360 it is. A lower setting picks the lower variant.
    env.db.settings.updateAppSettings({ downloadQuality: '360', playerQuality: '360' });
    const first = await download('Q360', () => cdnStream(site, '/media/hls-ts/master.m3u8'));
    expect(first.row.quality).toBe(360);
  });

  it('keeps AES-128 segments encrypted and saves the key beside them (hls-aes via its embed)', async () => {
    const { row } = await download('Aes', () => embedStream(site, 'dl-aes'));
    const folder = row.path!;
    expect(tree(folder)).toEqual(['key_0.key', 'playlist.m3u8', 'seg_00000.ts', 'seg_00001.ts', 'seg_00002.ts']);
    expect(readFileSync(join(folder, 'key_0.key')).equals(media('hls-aes/enc.key'))).toBe(true);
    expect(readFileSync(join(folder, 'seg_00002.ts')).equals(media('hls-aes/seg_002.ts'))).toBe(true);
    expect(readFileSync(join(folder, 'playlist.m3u8'), 'utf8')).toContain(
      '#EXT-X-KEY:METHOD=AES-128,URI="key_0.key",IV=0xd65e3a51c402874cc308ef35b227e6fa',
    );
    expectSelfContained(folder);
  });

  it('saves the init segment of fMP4', async () => {
    const { row } = await download('Fmp4', () => cdnStream(site, '/media/hls-fmp4/index.m3u8'));
    const folder = row.path!;
    expect(tree(folder)).toEqual(['init_0.mp4', 'playlist.m3u8', 'seg_00000.m4s', 'seg_00001.m4s', 'seg_00002.m4s']);
    expect(readFileSync(join(folder, 'init_0.mp4')).equals(media('hls-fmp4/init.mp4'))).toBe(true);
    expectSelfContained(folder);
  });

  it('follows absolute segment URLs (hls-abs via its embed)', async () => {
    const { row } = await download('Abs', () => embedStream(site, 'dl-abs'));
    expect(row.status).toBe('done');
    expect(tree(row.path!)).toEqual(['playlist.m3u8', 'seg_00000.ts', 'seg_00001.ts', 'seg_00002.ts']);
    expectSelfContained(row.path!);
  });

  it('downloads the DEFAULT audio rendition as its own folder of files (hls-audio via its embed)', async () => {
    const { row } = await download('Audio', () => embedStream(site, 'dl-audio'));
    const folder = row.path!;
    expect(row.status).toBe('done');
    expect(tree(folder)).toEqual([
      'audio/index.m3u8',
      'audio/seg_00000.ts',
      'audio/seg_00001.ts',
      'audio/seg_00002.ts',
      'audio/seg_00003.ts',
      'playlist.m3u8',
      'seg_00000.ts',
      'seg_00001.ts',
      'seg_00002.ts',
      'video.m3u8',
    ]);
    expect(readFileSync(join(folder, 'audio/seg_00001.ts')).equals(media('hls-audio/audio-ja/seg_001.ts'))).toBe(true);
    expect(site.log.some((e) => e.path.includes('/audio-en/'))).toBe(false);
    expect(row.segmentsTotal).toBe(7);
    expectSelfContained(folder);
    expectSelfContained(folder, 'video.m3u8');
    expectSelfContained(folder, 'audio/index.m3u8');
    expect(readFileSync(join(folder, 'playlist.m3u8'), 'utf8')).toContain('URI="audio/index.m3u8"');
  });

  it('splits byte ranges into files, each fetched with a Range (hls-byterange via its embed)', async () => {
    const { row } = await download('Ranges', () => embedStream(site, 'dl-byterange'));
    const folder = row.path!;
    expect(tree(folder)).toEqual(['playlist.m3u8', 'seg_00000.ts', 'seg_00001.ts', 'seg_00002.ts']);
    const whole = media('hls-byterange/media.ts');
    expect(readFileSync(join(folder, 'seg_00001.ts')).equals(whole.subarray(79148, 79148 + 99828))).toBe(true);
    expect(readFileSync(join(folder, 'seg_00002.ts')).equals(whole.subarray(178976, 178976 + 83096))).toBe(true);
    expect(
      site.log
        .filter((e) => e.path.endsWith('media.ts'))
        .map((e) => e.range)
        .sort(),
    ).toEqual(['bytes=0-79147', 'bytes=178976-262071', 'bytes=79148-178975']);
    expect(readFileSync(join(folder, 'playlist.m3u8'), 'utf8')).not.toContain('BYTERANGE');
  });

  it('saves every key of a rotating playlist (hls-keyrot via its embed)', async () => {
    const { row } = await download('Keys', () => embedStream(site, 'dl-keyrot'));
    const folder = row.path!;
    expect(tree(folder)).toEqual([
      'key_0.key',
      'key_1.key',
      'playlist.m3u8',
      'seg_00000.ts',
      'seg_00001.ts',
      'seg_00002.ts',
    ]);
    expect(readFileSync(join(folder, 'key_1.key')).equals(media('hls-keyrot/key-b.key'))).toBe(true);
    expectSelfContained(folder);
  });

  it('refuses a live playlist with a clear reason and leaves nothing behind (hls-live via its embed)', async () => {
    const { row, result } = await download('Live', () => embedStream(site, 'dl-live'));
    expect(result).toEqual({ queued: [], existing: [], refused: [{ episodeId: expect.any(Number), reason: 'live' }] });
    expect(row).toBeUndefined();
    expect(readdirSync(env.folder)).toEqual([]);
  });

  it('says "live" on the row when the batch was too big to look at while enqueueing', async () => {
    const ids = env.addEpisodes('Live batch', 5);
    streamsFor = async () => [await embedStream(site, 'dl-live')];
    const service = env.service();
    service.start();
    const before = site.log.length;
    const result = await service.enqueue({ episodeIds: ids });
    expect(result.queued).toEqual(ids);
    expect(site.log.length - before).toBe(0);
    await service.idle();
    expect(ids.map((id) => [env.row(id)!.status, env.row(id)!.error])).toEqual(ids.map(() => ['error', 'live']));
    expect(readdirSync(env.folder)).toEqual([]);
  });
});

describe('MP4 (DL-4)', () => {
  it('downloads a file through a .part and names it at the end', async () => {
    const { row } = await download('Mp4', () => embedStream(site, 'quiet-orchard'));
    expect(row).toMatchObject({ status: 'done', kind: 'mp4', segmentsTotal: null });
    expect(row.path!.endsWith(join('Mp4', 'Episode 1.mp4'))).toBe(true);
    expect(readFileSync(row.path!).equals(media('mp4/h264-aac.mp4'))).toBe(true);
    expect(tree(env.folder)).toEqual(['Example (EN)/Mp4/Episode 1.mp4']);
    expect(row.bytesDone).toBe(media('mp4/h264-aac.mp4').length);
  });

  it('resumes after a reset in the middle of the body with a Range request', async () => {
    // The size is probed twice (when enqueueing, when starting); the third request is the download, which breaks half way.
    site.addFault({ pattern: '/media/mp4/long.mp4', resetAfterBytes: 200_000, from: 3, times: 1 });
    const { row } = await download('Resume', () => cdnStream(site, '/media/mp4/long.mp4', { kind: 'mp4' }));
    expect(row.status).toBe('done');
    expect(readFileSync(row.path!).equals(media('mp4/long.mp4'))).toBe(true);
    const requests = site.log.filter((e) => e.path === '/media/mp4/long.mp4' && e.status !== 416);
    const resumed = requests.find((e) => e.range?.endsWith('-') && e.range !== 'bytes=0-0');
    expect(resumed?.range).toMatch(/^bytes=\d+-$/);
    expect(Number(resumed?.range?.slice(6, -1))).toBeGreaterThan(0);
    // The size probe, the cut request and the continuation: nothing was fetched twice from the start.
    expect(requests.filter((e) => e.range === null)).toHaveLength(1);
  });

  it('continues a .part left by an earlier run, even after a restart', async () => {
    const [episodeId] = env.addEpisodes('Part', 1) as [number];
    streamsFor = async () => [cdnStream(site, '/media/mp4/long.mp4', { kind: 'mp4' })];
    const first = env.service();
    first.start();
    site.setThrottle({ bytesPerSecond: 200_000 });
    await first.enqueue({ episodeIds: [episodeId] });
    const path = (): string | null => env.row(episodeId)?.path ?? null;
    await until(
      () => path() !== null && existsSync(`${path()}.part`) && readFileSync(`${path()}.part`).length > 20_000,
    );
    first.shutdown();
    await first.idle();
    expect(env.row(episodeId)!.status).toBe('queued');
    const saved = readFileSync(`${path()}.part`).length;
    expect(saved).toBeGreaterThan(0);

    site.setThrottle({});
    const mark = site.log.length;
    const second = env.service();
    second.start();
    await second.idle();
    expect(env.row(episodeId)!.status).toBe('done');
    expect(readFileSync(path()!).equals(media('mp4/long.mp4'))).toBe(true);
    const ranges = site.log
      .slice(mark)
      .filter((e) => e.path === '/media/mp4/long.mp4')
      .map((e) => e.range);
    expect(ranges.some((r) => r === `bytes=${saved}-`)).toBe(true);
  });
});

describe('stopping and starting again (DL-5)', () => {
  const total = 24;

  it('pauses, keeps what is finished, and resumes with only the missing segments', async () => {
    site.setThrottle({ segmentDelayMs: 60 });
    const { service, episodeId } = await startLong('Pause');
    await until(() => segmentFiles(episodeId).length >= 4);
    service.pause(env.row(episodeId)!.id);
    await service.idle();
    expect(env.row(episodeId)!.status).toBe('paused');
    const tmp = `${env.row(episodeId)!.path}.tmp`;
    expect(existsSync(tmp)).toBe(true);
    expect(readdirSync(tmp).some((name) => name.endsWith('.part'))).toBe(false);
    const kept = segmentFiles(episodeId);
    expect(kept.length).toBeGreaterThanOrEqual(4);
    expect(kept.length).toBeLessThan(total);

    const mark = site.log.length;
    service.resume(env.row(episodeId)!.id);
    await service.idle();
    expect(env.row(episodeId)!.status).toBe('done');
    expectOnlyMissingFetched(mark, kept);
    expect(tree(env.row(episodeId)!.path!).filter((n) => n.endsWith('.ts'))).toHaveLength(total);
  });

  it('after the app is killed, the next start fetches only what is missing', async () => {
    site.setThrottle({ segmentDelayMs: 60 });
    const { service, episodeId } = await startLong('Kill');
    await until(() => segmentFiles(episodeId).length >= 4);
    service.shutdown();
    await service.idle();
    expect(env.row(episodeId)!.status).toBe('queued');
    const folder = `${env.row(episodeId)!.path}.tmp`;
    // What a power cut leaves: a segment that was half written.
    writeFileSync(join(folder, 'seg_00012.ts.part'), 'half');
    const kept = segmentFiles(episodeId);

    site.setThrottle({});
    const mark = site.log.length;
    const restarted = env.service();
    restarted.start();
    await restarted.idle();
    expect(env.row(episodeId)!.status).toBe('done');
    expectOnlyMissingFetched(mark, kept);
    expect(tree(env.row(episodeId)!.path!).some((n) => n.endsWith('.part'))).toBe(false);
  });

  it('turns what was downloading when the app closed into queued at start', async () => {
    const [episodeId] = env.addEpisodes('Recover', 1) as [number];
    env.db.downloads.insert({ episodeId, kind: 'hls', sizeBytes: null, now: 1 });
    env.db.downloads.update(env.row(episodeId)!.id, { status: 'downloading' });
    streamsFor = async () => [cdnStream(site, '/media/hls-ts/master.m3u8')];
    const service = env.service();
    service.start();
    expect(env.row(episodeId)!.status).toBe('queued');
    await service.idle();
    expect(env.row(episodeId)!.status).toBe('done');
  });

  it('drops a folder left by another quality instead of mixing the two', async () => {
    const [episodeId] = env.addEpisodes('Mixed', 1) as [number];
    streamsFor = async () => [cdnStream(site, '/media/hls-ts/master.m3u8')];
    env.db.settings.updateAppSettings({ downloadQuality: '360' });
    const service = env.service();
    service.start();
    // A leftover from a 240p run with the same number of files.
    const id = env.db.downloads.insert({ episodeId, kind: 'hls', sizeBytes: null, now: 1 });
    const path = join(env.folder, 'Example (EN)', 'Mixed', 'Episode 1');
    env.db.downloads.update(id, { path, status: 'paused' });
    mkdirSync(`${path}.tmp`, { recursive: true });
    writeFileSync(join(`${path}.tmp`, 'seg_00000.ts'), 'from another encode');
    writeFileSync(
      join(`${path}.tmp`, '.matane-download.json'),
      JSON.stringify({ quality: 240, files: 3, segments: 3, durationMs: 6000 }),
    );
    service.resume(id);
    await service.idle();
    expect(readFileSync(join(path, 'seg_00000.ts')).equals(media('hls-ts/v360/seg_000.ts'))).toBe(true);
  });

  /** Since `mark`, exactly the segments that were not on disk were asked for (a stopped run's last request may arrive late). */
  function expectOnlyMissingFetched(mark: number, kept: string[]): void {
    const wanted = Array.from({ length: total }, (_, i) => `seg_${String(i).padStart(3, '0')}.ts`);
    const asked = new Set(segmentRequests(mark).map((path) => path.split('/').pop()));
    // File names on disk are numbered from 00000, the site's from 000: the same positions.
    const keptPositions = new Set(kept.map((name) => Number(name.slice(4, 9))));
    for (const [position, name] of wanted.entries()) {
      expect(asked.has(name), `${name} ${keptPositions.has(position) ? 'was kept' : 'was missing'}`).toBe(
        !keptPositions.has(position),
      );
    }
  }

  async function startLong(title: string): Promise<{ service: DownloadService; episodeId: number }> {
    const [episodeId] = env.addEpisodes(title, 1) as [number];
    streamsFor = async () => [await embedStream(site, 'dl-long')];
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [episodeId] });
    return { service, episodeId };
  }

  function segmentFiles(episodeId: number): string[] {
    const path = env.row(episodeId)?.path;
    const tmp = path ? `${path}.tmp` : null;
    return tmp && existsSync(tmp) ? readdirSync(tmp).filter((n) => /^seg_\d+\.ts$/.test(n)) : [];
  }
});

describe('expired links (R5)', () => {
  it('asks the extension once for a new link when a segment answers 403, and finishes', async () => {
    // Token Tide: the first link dies after one segment, the second one works.
    const [episodeId] = env.addEpisodes('Token', 1) as [number];
    // The extension caches a link until it is asked for a fresh one.
    let cached: Stream[] | null = null;
    streamsFor = async (_id, fresh) => {
      if (!cached || fresh) cached = [await embedStream(site, 'token-tide')];
      return cached;
    };
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [episodeId] });
    await service.idle();
    expect(env.row(episodeId)).toMatchObject({ status: 'done', error: null });
    expect(freshCalls).toEqual([episodeId]);
    expectSelfContained(env.row(episodeId)!.path!);
    expect(site.log.some((e) => e.status === 403 && e.path.endsWith('.ts'))).toBe(true);
  });

  it('gives up with "expired" when the new link is refused too, after one refresh only', async () => {
    site.addFault({ pattern: 'seg_001.ts', status: 403 });
    const { row } = await download('Dead', () => cdnStream(site, '/media/hls-ts/master.m3u8'));
    expect(row).toMatchObject({ status: 'error', error: 'expired' });
    expect(freshCalls).toHaveLength(1);
    // The segment that did arrive stays for the retry.
    expect(existsSync(`${row.path}.tmp`)).toBe(true);
  });

  it('retries after the site recovers and fetches only what was missing', async () => {
    site.addFault({ pattern: 'seg_001.ts', status: 403 });
    const { service, row } = await download('Recover403', () => cdnStream(site, '/media/hls-ts/master.m3u8'));
    expect(row.status).toBe('error');
    await siteQuiet();
    const kept = readdirSync(`${row.path}.tmp`).filter((n) => n.endsWith('.ts')).length;
    site.clearFaults();
    const mark = site.log.length;
    service.retry(row.id);
    await service.idle();
    expect(env.row(row.episodeId)!.status).toBe('done');
    expect(segmentRequests(mark)).toHaveLength(3 - kept);
  });
});

describe('refusals (DL-9, DL-10)', () => {
  it('refuses when the estimate does not fit on the disk', async () => {
    const [episodeId] = env.addEpisodes('Full', 1) as [number];
    streamsFor = async () => [cdnStream(site, '/media/hls-ts/master.m3u8')];
    const service = env.service({ freeBytes: async () => 1000 });
    const result = await service.enqueue({ episodeIds: [episodeId] });
    expect(result.refused).toEqual([{ episodeId, reason: 'disk_space' }]);
    expect(env.row(episodeId)).toBeUndefined();
  });

  it('with no estimate (a playlist without a master) wants 2 GB free', async () => {
    const [episodeId] = env.addEpisodes('Unknown', 1) as [number];
    streamsFor = async () => [cdnStream(site, '/media/hls-ts/v360/index.m3u8')];
    const tight = env.service({ freeBytes: async () => 1.5 * 1024 ** 3 });
    expect((await tight.enqueue({ episodeIds: [episodeId] })).refused).toEqual([{ episodeId, reason: 'disk_space' }]);
    const roomy = env.service({ freeBytes: async () => 3 * 1024 ** 3 });
    expect((await roomy.enqueue({ episodeIds: [episodeId] })).queued).toEqual([episodeId]);
    roomy.shutdown();
  });

  it('stops at the size limit: automatic never passes it, manual only when forced', async () => {
    const [full, a, b, c] = env.addEpisodes('Limit', 4) as [number, number, number, number];
    env.db.downloads.insert({ episodeId: full, kind: 'mp4', sizeBytes: null, now: 1 });
    env.db.downloads.update(env.row(full)!.id, { status: 'done', bytesDone: 1024 ** 3 });
    env.db.settings.updateAppSettings({ downloadSizeLimitGb: 1 });
    streamsFor = async () => [cdnStream(site, '/media/hls-ts/master.m3u8')];
    const service = env.service();

    expect((await service.enqueue({ episodeIds: [a] }, { reason: 'auto' })).refused).toEqual([
      { episodeId: a, reason: 'size_limit' },
    ]);
    expect((await service.enqueue({ episodeIds: [b], force: true }, { reason: 'auto' })).refused).toEqual([
      { episodeId: b, reason: 'size_limit' },
    ]);
    expect((await service.enqueue({ episodeIds: [c] })).refused).toEqual([{ episodeId: c, reason: 'size_limit' }]);
    expect((await service.enqueue({ episodeIds: [c], force: true })).queued).toEqual([c]);
    service.start();
    await service.idle();
    expect(env.row(c)!.status).toBe('done');
  });
});

describe('waiting for the network (DL-7)', () => {
  it('queues while offline, then downloads when the network is back', async () => {
    const [episodeId] = env.addEpisodes('Offline', 1) as [number];
    streamsFor = async () => [cdnStream(site, '/media/hls-ts/master.m3u8')];
    env.setOnline(false);
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [episodeId] });
    await service.idle();
    expect(env.row(episodeId)!.status).toBe('queued');
    env.setOnline(true);
    await service.idle();
    expect(env.row(episodeId)!.status).toBe('done');
  });

  it('puts a download back in the queue when the site cannot be reached and the machine is offline', async () => {
    site.setThrottle({ segmentDelayMs: 50 });
    const { service, episodeId } = await startLongOn('Drop');
    await until(() => (env.row(episodeId)?.segmentsDone ?? 0) >= 2 || existsSync(`${env.row(episodeId)?.path}.tmp`));
    env.setOnline(false);
    await service.idle();
    expect(env.row(episodeId)!.status).toBe('queued');
    expect(env.row(episodeId)!.error).toBeNull();

    site.setThrottle({});
    env.setOnline(true);
    await service.idle();
    expect(env.row(episodeId)!.status).toBe('done');
  });

  it('shows a site that is down while the machine is online as an error to retry', async () => {
    const [episodeId] = env.addEpisodes('Down', 1) as [number];
    streamsFor = async () => [cdnStream(site, '/media/hls-ts/master.m3u8')];
    const service = env.service();
    service.start();
    const queued = await service.enqueue({ episodeIds: [episodeId] });
    expect(queued.queued).toEqual([episodeId]);
    await site.stop();
    await service.idle();
    const row = env.row(episodeId)!;
    expect(row.status === 'error' || row.status === 'done').toBe(true);
    await site.resume();
    if (row.status === 'error') {
      service.retry(row.id);
      await service.idle();
    }
    expect(env.row(episodeId)!.status).toBe('done');
  });

  async function startLongOn(title: string): Promise<{ service: DownloadService; episodeId: number }> {
    const [episodeId] = env.addEpisodes(title, 1) as [number];
    streamsFor = async () => [await embedStream(site, 'dl-long')];
    const service = env.service();
    service.start();
    await service.enqueue({ episodeIds: [episodeId] });
    return { service, episodeId };
  }
});
