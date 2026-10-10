import { describe, expect, it, vi } from 'vitest';

const headers: Record<string, string> = {};
vi.mock('electron', () => ({
  net: {
    request: vi.fn(() => ({
      setHeader: (name: string, value: string) => void (headers[name] = value),
      on: vi.fn(),
      end: vi.fn(),
      abort: vi.fn(),
    })),
  },
}));

import type { Session } from 'electron';
import { RepoFetcher } from './repo-fetcher';

describe('RepoFetcher', () => {
  it('asks for a revalidated copy, so a just-published index is not served from the HTTP cache', () => {
    const fetcher = new RepoFetcher({ session: {} as Session, userAgent: () => 'UA/1', isOnline: () => true });
    void fetcher.get('https://repo.test/index.json', { maxBytes: 1024 }).catch(() => undefined);
    expect(headers['cache-control']).toBe('no-cache');
    expect(headers['user-agent']).toBe('UA/1');
  });
});
