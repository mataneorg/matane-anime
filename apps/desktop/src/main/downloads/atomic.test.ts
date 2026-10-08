import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fileSize,
  finalizeFile,
  finalizeFolder,
  pathExists,
  pruneEmptyParents,
  removeParts,
  removePath,
  treeSize,
  writeFileAtomic,
} from './atomic';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'matane-atomic-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('atomic writes', () => {
  it('writes through a .part file and leaves only the finished one', async () => {
    const target = join(dir, 'a', 'playlist.m3u8');
    await writeFileAtomic(target, '#EXTM3U\n');
    expect(readFileSync(target, 'utf8')).toBe('#EXTM3U\n');
    expect(readdirSync(join(dir, 'a'))).toEqual(['playlist.m3u8']);
    await writeFileAtomic(target, 'new');
    expect(readFileSync(target, 'utf8')).toBe('new');
  });

  it('measures files and trees, and tolerates what is missing', async () => {
    mkdirSync(join(dir, 'ep', 'audio'), { recursive: true });
    writeFileSync(join(dir, 'ep', 'a.ts'), '12345');
    writeFileSync(join(dir, 'ep', 'audio', 'b.ts'), '123');
    expect(await fileSize(join(dir, 'ep', 'a.ts'))).toBe(5);
    expect(await fileSize(join(dir, 'ep'))).toBeNull();
    expect(await fileSize(join(dir, 'nope'))).toBeNull();
    expect(await treeSize(join(dir, 'ep'))).toBe(8);
    expect(await treeSize(join(dir, 'nope'))).toBe(0);
    expect(await pathExists(join(dir, 'ep'))).toBe(true);
    await removePath(join(dir, 'ep'));
    await removePath(join(dir, 'ep'));
    expect(await pathExists(join(dir, 'ep'))).toBe(false);
  });

  it('drops half-written files but keeps finished segments (kept for the retry)', async () => {
    mkdirSync(join(dir, 'ep.tmp', 'audio'), { recursive: true });
    writeFileSync(join(dir, 'ep.tmp', 'seg_00000.ts'), 'done');
    writeFileSync(join(dir, 'ep.tmp', 'seg_00001.ts.part'), 'half');
    writeFileSync(join(dir, 'ep.tmp', 'audio', 'seg_00000.ts.part'), 'half');
    writeFileSync(join(dir, 'ep.tmp', 'audio', 'seg_00001.ts'), 'done');
    await removeParts(join(dir, 'ep.tmp'));
    expect(readdirSync(join(dir, 'ep.tmp')).sort()).toEqual(['audio', 'seg_00000.ts']);
    expect(readdirSync(join(dir, 'ep.tmp', 'audio'))).toEqual(['seg_00001.ts']);
    await removeParts(join(dir, 'missing'));
  });

  it('renames the folder only at the end, replacing a stale one', async () => {
    mkdirSync(join(dir, 'Anime', 'Ep 1'), { recursive: true });
    writeFileSync(join(dir, 'Anime', 'Ep 1', 'old.ts'), 'stale');
    mkdirSync(join(dir, 'Anime', 'Ep 1.tmp'));
    writeFileSync(join(dir, 'Anime', 'Ep 1.tmp', 'seg_00000.ts'), 'new');
    await finalizeFolder(join(dir, 'Anime', 'Ep 1.tmp'), join(dir, 'Anime', 'Ep 1'));
    expect(readdirSync(join(dir, 'Anime'))).toEqual(['Ep 1']);
    expect(readdirSync(join(dir, 'Anime', 'Ep 1'))).toEqual(['seg_00000.ts']);
  });

  it('gives a finished MP4 its name, creating the folders', async () => {
    mkdirSync(join(dir, 'x'));
    writeFileSync(join(dir, 'x', 'e.mp4.part'), 'video');
    await finalizeFile(join(dir, 'x', 'e.mp4.part'), join(dir, 'y', 'z', 'e.mp4'));
    expect(readFileSync(join(dir, 'y', 'z', 'e.mp4'), 'utf8')).toBe('video');
  });

  it('removes empty parents up to the root and stops at the first that has something', async () => {
    mkdirSync(join(dir, 'src', 'anime'), { recursive: true });
    mkdirSync(join(dir, 'src', 'other'), { recursive: true });
    await pruneEmptyParents(join(dir, 'src', 'anime'), dir);
    expect(readdirSync(join(dir, 'src'))).toEqual(['other']);
    await pruneEmptyParents(join(dir, 'src', 'other'), dir);
    expect(readdirSync(dir)).toEqual([]);
  });
});
