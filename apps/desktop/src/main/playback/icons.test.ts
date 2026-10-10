import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIconHandler } from './icons';

const icon = (id: string, method = 'GET'): Request => new Request(`anime://icon/${encodeURIComponent(id)}`, { method });

describe('createIconHandler', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'icons-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('serves icon.png from the first folder that has one', async () => {
    await writeFile(join(dir, 'icon.png'), new Uint8Array([1, 2, 3]));
    const handler = createIconHandler({ iconFolders: () => [join(dir, 'missing'), dir] });
    const response = await handler(icon('my.ext'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('passes the decoded extension id to the lookup', async () => {
    const seen: string[] = [];
    const handler = createIconHandler({
      iconFolders: (id) => {
        seen.push(id);
        return [];
      },
    });
    await handler(icon('a b/c'));
    expect(seen).toEqual(['a b/c']);
  });

  it('answers 404 when no folder has an icon, or the extension is unknown', async () => {
    expect((await createIconHandler({ iconFolders: () => [dir] })(icon('x'))).status).toBe(404);
    expect((await createIconHandler({})(icon('x'))).status).toBe(404);
  });

  it('skips an icon that is empty or too large', async () => {
    await writeFile(join(dir, 'icon.png'), new Uint8Array(0));
    expect((await createIconHandler({ iconFolders: () => [dir] })(icon('x'))).status).toBe(404);
    await writeFile(join(dir, 'icon.png'), new Uint8Array(300 * 1024));
    expect((await createIconHandler({ iconFolders: () => [dir] })(icon('x'))).status).toBe(404);
  });

  it('refuses anything but GET', async () => {
    expect((await createIconHandler({})(icon('x', 'POST'))).status).toBe(405);
  });

  describe('the icon of a repository', () => {
    const withRepo = (id: string, repo: string): Request =>
      new Request(`anime://icon/${encodeURIComponent(id)}?repo=${repo}`);

    it('is served when no loaded copy has an icon', async () => {
      const asked: [number, string][] = [];
      const handler = createIconHandler({
        iconFolders: () => [dir],
        repoIcon: async (repoId, id) => {
          asked.push([repoId, id]);
          return new Uint8Array([9, 8]);
        },
      });
      const response = await handler(withRepo('my.ext', '3'));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([9, 8]);
      expect(asked).toEqual([[3, 'my.ext']]);
    });

    it('comes after the icon of an installed copy', async () => {
      await writeFile(join(dir, 'icon.png'), new Uint8Array([1]));
      const handler = createIconHandler({
        iconFolders: () => [dir],
        repoIcon: async () => new Uint8Array([2]),
      });
      expect([...new Uint8Array(await (await handler(withRepo('x', '1'))).arrayBuffer())]).toEqual([1]);
    });

    it('answers 404 when the repository has none, fails, or the id is not a number', async () => {
      const none = createIconHandler({ repoIcon: async () => null });
      expect((await none(withRepo('x', '1'))).status).toBe(404);
      const broken = createIconHandler({
        repoIcon: async () => {
          throw new Error('offline');
        },
      });
      expect((await broken(withRepo('x', '1'))).status).toBe(404);
      let asked = false;
      const strict = createIconHandler({
        repoIcon: async () => {
          asked = true;
          return new Uint8Array([1]);
        },
      });
      for (const repo of ['abc', '0', '-2', '1.5', '']) expect((await strict(withRepo('x', repo))).status).toBe(404);
      expect(asked).toBe(false);
    });
  });
});
