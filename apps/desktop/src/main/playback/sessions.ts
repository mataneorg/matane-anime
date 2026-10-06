import { randomBytes } from 'node:crypto';
import { hostOf } from './m3u8';

export type SessionKind = 'hls' | 'file';

export interface PlaybackSession {
  id: string;
  /** The URL of the playlist (HLS) or of the media file. */
  entryUrl: string;
  kind: SessionKind;
  /** Sent with every upstream request (Referer, Origin…). Never visible to the renderer. */
  headers: Record<string, string>;
  /** `host:port` values the session may fetch from: the entry host plus every host found in its playlists. */
  hostsSeen: Set<string>;
  /** The extension whose session, cookies and media rate limit upstream requests use. Absent in the spike. */
  extensionId?: string;
}

export interface NewSession {
  entryUrl: string;
  kind: SessionKind;
  headers?: Record<string, string>;
  extensionId?: string;
}

/**
 * Sessions are created by main only; the renderer can name one in a URL but never make one, and a URL
 * outside a session's `hostsSeen` is refused (docs/PRD.md §8.3, "Hardening").
 */
export class SessionStore {
  private readonly sessions = new Map<string, PlaybackSession>();

  create(input: NewSession): PlaybackSession {
    const session: PlaybackSession = {
      id: randomBytes(12).toString('base64url'),
      entryUrl: input.entryUrl,
      kind: input.kind,
      headers: { ...input.headers },
      hostsSeen: new Set([hostOf(input.entryUrl)]),
      ...(input.extensionId !== undefined && { extensionId: input.extensionId }),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): PlaybackSession | undefined {
    return this.sessions.get(id);
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  clear(): void {
    this.sessions.clear();
  }

  get size(): number {
    return this.sessions.size;
  }
}
