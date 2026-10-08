import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Stream } from '@matane-anime/extension-sdk';
import { AppError, DOWNLOAD_FILE_MISSING } from '@matane-anime/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type TestDb, createTestDb } from '../db/__tests__/helpers';
import { RequestRegistry } from '../ipc/requests';
import { PlaybackService } from './service';
import { SessionStore } from './sessions';

vi.mock('electron', () => ({ powerSaveBlocker: { start: vi.fn(() => 1), stop: vi.fn() } }));

const SOURCE = 'example/en';
const STREAM: Stream = { url: 'http://site.test/watch/index.m3u8', server: 'Server A', quality: 720 };

interface Harness {
  db: TestDb;
  service: PlaybackService;
  sessions: SessionStore;
  folder: string;
  episodeId: number;
  calls: string[];
  options: { available: boolean; streams: Stream[] };
}

let harness: Harness;

async function setup(): Promise<Harness> {
  const db = await createTestDb();
  const folder = mkdtempSync(join(tmpdir(), 'matane-playback-'));
  const [row] = db.anime.upsertSummaries(SOURCE, [{ url: '/a', title: 'Anime' }]);
  db.episodes.sync(
    row!.id,
    [1, 2].map((n) => ({ url: `/a/${n}`, name: `Episode ${n}`, number: n })),
    100,
  );
  const episodeId = (
    db.connection.sqlite.prepare('SELECT id FROM episodes WHERE anime_id = ? AND number = 1').get(row!.id) as {
      id: number;
    }
  ).id;
  const calls: string[] = [];
  const options = { available: true, streams: [STREAM] };
  const sessions = new SessionStore();
  const service = new PlaybackService({
    extensions: {
      assertAvailable: () => {
        calls.push('assertAvailable');
        if (!options.available) throw new AppError('extension', 'The extension is not installed');
      },
      streamsFor: async () => {
        calls.push('streamsFor');
        return options.streams;
      },
    } as never,
    anime: db.anime,
    episodes: db.episodes,
    settings: db.settings,
    store: db.store,
    sessions,
    downloads: db.downloads,
    upstream: async () => {
      calls.push('upstream');
      return new Response('#EXTM3U\n', { status: 200 });
    },
    requests: new RequestRegistry(),
    resumeFor: () => 1234,
  });
  return { db, service, sessions, folder, episodeId, calls, options };
}

/** A finished HLS download on disk and in the database. */
function finishHls(h: Harness, quality: number | null = 1080): string {
  const path = join(h.folder, 'Episode 1');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'playlist.m3u8'), '#EXTM3U\n');
  const id = h.db.downloads.insert({ episodeId: h.episodeId, kind: 'hls', sizeBytes: null, now: 1 });
  h.db.downloads.update(id, { status: 'done', path, quality, bytesDone: 10, completedAt: 2 });
  return path;
}

function finishMp4(h: Harness): string {
  const path = join(h.folder, 'Episode 1.mp4');
  writeFileSync(path, 'mp4');
  const id = h.db.downloads.insert({ episodeId: h.episodeId, kind: 'mp4', sizeBytes: null, now: 1 });
  h.db.downloads.update(id, { status: 'done', path, bytesDone: 3, completedAt: 2 });
  return path;
}

beforeEach(async () => {
  harness = await setup();
});
afterEach(() => {
  harness.db.close();
  rmSync(harness.folder, { recursive: true, force: true });
});

describe('PlaybackService: playing a download (STR-7)', () => {
  it('plays an HLS download from disk before touching the extension or the network', async () => {
    const h = harness;
    const path = finishHls(h);
    const dto = await h.service.start(h.episodeId);
    expect(h.calls).toEqual([]);
    expect(dto.kind).toBe('hls');
    expect(dto.url).toMatch(/^anime:\/\/play\/[\w-]+\/playlist\.m3u8$/);
    expect(dto.resumeMs).toBe(1234);
    expect(dto.streams).toEqual([
      { index: 0, server: 'Downloaded', quality: 1080, kind: 'hls', status: 'playing', lastWorked: false },
    ]);
    expect(dto.activeIndex).toBe(0);
    expect(dto.episodeName).toBe('Episode 1');
    expect(dto.next).not.toBeNull();

    const session = h.sessions.get(dto.url.split('/')[3]!);
    expect(session?.kind).toBe('local');
    expect(session?.local).toEqual({ path, media: 'hls' });
    expect(session?.hostsSeen.size).toBe(0);
  });

  it('plays an MP4 download from its file', async () => {
    const h = harness;
    const path = finishMp4(h);
    const dto = await h.service.start(h.episodeId);
    expect(h.calls).toEqual([]);
    expect(dto.kind).toBe('mp4');
    expect(dto.url).toMatch(/\/media\.mp4$/);
    expect(dto.streams[0]).toMatchObject({ server: 'Downloaded', quality: null, kind: 'mp4' });
    expect(h.sessions.get(dto.url.split('/')[3]!)?.local).toEqual({ path, media: 'mp4' });
  });

  it('works when the extension is not installed', async () => {
    const h = harness;
    finishHls(h);
    h.options.available = false;
    await expect(h.service.start(h.episodeId)).resolves.toMatchObject({ kind: 'hls' });
    expect(h.calls).toEqual([]);
  });

  it('closing the playback drops its local session', async () => {
    const h = harness;
    finishHls(h);
    const dto = await h.service.start(h.episodeId);
    expect(h.sessions.size).toBe(1);
    h.service.close(dto.playbackId);
    expect(h.sessions.size).toBe(0);
  });

  it('switching to the only candidate changes nothing and remembers nothing', async () => {
    const h = harness;
    finishHls(h);
    const dto = await h.service.start(h.episodeId);
    const switched = await h.service.switchStream(dto.playbackId, 0);
    expect(switched.url).toBe(dto.url);
    expect(h.sessions.size).toBe(1);
    expect(h.calls).toEqual([]);
    await expect(h.service.switchStream(dto.playbackId, 1)).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('a first frame is acknowledged without recording "Downloaded" as the last server', async () => {
    const h = harness;
    finishHls(h);
    const dto = await h.service.start(h.episodeId);
    await expect(h.service.event(dto.playbackId, { type: 'playing' })).resolves.toEqual({ type: 'ok' });
    expect(h.db.settings.getValue(`playback.lastServer.${SOURCE}`, null)).toBeNull();
  });

  it('a playback error ends in a clear failure, not a hunt for other servers', async () => {
    const h = harness;
    finishHls(h);
    const dto = await h.service.start(h.episodeId);
    const update = await h.service.event(dto.playbackId, { type: 'error', httpStatus: null, message: 'media: decode' });
    expect(update).toEqual({ type: 'failed', tried: ['Downloaded'], message: 'media: decode', httpStatus: null });
    expect(h.calls).toEqual([]);
    expect(h.db.downloads.byEpisode(h.episodeId)?.status).toBe('done');
  });

  it('an error after the files vanished marks the download file_missing', async () => {
    const h = harness;
    const path = finishHls(h);
    const dto = await h.service.start(h.episodeId);
    rmSync(path, { recursive: true });
    const update = await h.service.event(dto.playbackId, {
      type: 'error',
      httpStatus: 404,
      message: 'manifestLoadError',
    });
    expect(update).toMatchObject({ type: 'failed', message: 'The downloaded files are missing', httpStatus: 404 });
    expect(h.db.downloads.byEpisode(h.episodeId)).toMatchObject({ status: 'error', error: DOWNLOAD_FILE_MISSING });
  });
});

describe('PlaybackService: falling back to streaming', () => {
  it('streams as before when there is no download', async () => {
    const h = harness;
    const dto = await h.service.start(h.episodeId);
    expect(h.calls).toEqual(['assertAvailable', 'streamsFor', 'upstream']);
    expect(dto.streams).toHaveLength(1);
    expect(dto.streams[0]).toMatchObject({ server: 'Server A', quality: 720 });
    expect(h.sessions.get(dto.url.split('/')[3]!)?.kind).toBe('hls');
  });

  it('still needs the extension to stream: an unavailable one fails as before', async () => {
    const h = harness;
    h.options.available = false;
    await expect(h.service.start(h.episodeId)).rejects.toThrow('not installed');
    expect(h.calls).toEqual(['assertAvailable']);
  });

  it.each(['queued', 'downloading', 'paused', 'error'] as const)('ignores a download that is %s', async (status) => {
    const h = harness;
    const path = finishHls(h);
    h.db.downloads.update(h.db.downloads.byEpisode(h.episodeId)!.id, { status, path, error: null });
    const dto = await h.service.start(h.episodeId);
    expect(dto.streams[0]?.server).toBe('Server A');
    expect(h.db.downloads.byEpisode(h.episodeId)?.status).toBe(status);
  });

  it('marks a download whose playlist is gone as file_missing and streams instead', async () => {
    const h = harness;
    const path = finishHls(h);
    rmSync(join(path, 'playlist.m3u8'));
    const before = h.db.emitted.length;
    const dto = await h.service.start(h.episodeId);
    expect(dto.streams[0]?.server).toBe('Server A');
    expect(h.calls).toEqual(['assertAvailable', 'streamsFor', 'upstream']);
    expect(h.db.downloads.byEpisode(h.episodeId)).toMatchObject({
      status: 'error',
      error: DOWNLOAD_FILE_MISSING,
      bytesDone: 10,
      path,
    });
    expect(h.db.emitted.slice(before).some((tags) => tags.includes('downloads'))).toBe(true);
  });

  it('marks a download whose mp4 is gone as file_missing and streams instead', async () => {
    const h = harness;
    rmSync(finishMp4(h));
    const dto = await h.service.start(h.episodeId);
    expect(dto.streams[0]?.server).toBe('Server A');
    expect(h.db.downloads.byEpisode(h.episodeId)).toMatchObject({ status: 'error', error: DOWNLOAD_FILE_MISSING });
  });

  it('a directory where the mp4 should be does not count as a file', async () => {
    const h = harness;
    const path = finishMp4(h);
    rmSync(path);
    mkdirSync(path);
    const dto = await h.service.start(h.episodeId);
    expect(dto.streams[0]?.server).toBe('Server A');
    expect(h.db.downloads.byEpisode(h.episodeId)?.error).toBe(DOWNLOAD_FILE_MISSING);
  });

  it('does not stream when the extension is gone and the files are missing: the error says why', async () => {
    const h = harness;
    rmSync(finishMp4(h));
    h.options.available = false;
    await expect(h.service.start(h.episodeId)).rejects.toThrow('not installed');
    expect(h.db.downloads.byEpisode(h.episodeId)?.error).toBe(DOWNLOAD_FILE_MISSING);
  });
});
