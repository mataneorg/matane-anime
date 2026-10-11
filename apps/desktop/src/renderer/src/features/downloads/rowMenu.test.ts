import type { DownloadStatus } from '@matane-anime/shared';
import { describe, expect, it } from 'vitest';
import { downloadMenu } from './rowMenu';

const STATUSES: DownloadStatus[] = ['downloading', 'queued', 'paused', 'error', 'done'];

const actions = (status: DownloadStatus, canMoveUp = true) => {
  const menu = downloadMenu(status, canMoveUp);
  return { main: menu.main.map((entry) => entry.action), destructive: menu.destructive.map((entry) => entry.action) };
};

describe('downloadMenu', () => {
  it('lets a running download pause or be cancelled', () => {
    expect(actions('downloading')).toEqual({ main: ['pause', 'openAnime', 'openFolder'], destructive: ['cancel'] });
  });

  it('lets a paused download resume or be cancelled', () => {
    expect(actions('paused')).toEqual({ main: ['resume', 'openAnime', 'openFolder'], destructive: ['cancel'] });
  });

  it('lets a failed download retry or leave the list', () => {
    expect(actions('error')).toEqual({ main: ['retry', 'openAnime', 'openFolder'], destructive: ['remove'] });
  });

  it('lets a finished download play or have its file deleted', () => {
    expect(actions('done')).toEqual({ main: ['play', 'openAnime', 'openFolder'], destructive: ['delete'] });
  });

  it('lets a queued download move up the queue or be cancelled', () => {
    expect(actions('queued')).toEqual({ main: ['moveUp', 'openAnime', 'openFolder'], destructive: ['cancel'] });
  });

  it('disables moving up when the row cannot move further up', () => {
    expect(downloadMenu('queued', false).main[0]).toEqual({ action: 'moveUp', disabled: true });
    expect(downloadMenu('queued', true).main[0]).toEqual({ action: 'moveUp' });
  });

  it('only offers moving up to queued downloads', () => {
    for (const status of STATUSES.filter((status) => status !== 'queued')) {
      expect(actions(status).main).not.toContain('moveUp');
    }
  });

  it('always offers both ways to open, and keeps removals out of the usual entries', () => {
    for (const status of STATUSES) {
      const { main, destructive } = actions(status);
      expect(main).toEqual(expect.arrayContaining(['openAnime', 'openFolder']));
      expect(destructive.length).toBeGreaterThan(0);
      expect(main.filter((action) => ['cancel', 'remove', 'delete'].includes(action))).toEqual([]);
    }
  });
});
