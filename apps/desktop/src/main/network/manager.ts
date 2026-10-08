import type { CloudflareStatus } from '@matane-anime/shared';
import { session } from 'electron';
import type { SettingsRepository } from '../db/repositories/settings';
import { CloudflareSolver } from './cloudflare';
import { ExtensionFetcher } from './extension-fetcher';
import { NetworkStatus } from './status';
import { defaultUserAgent } from './user-agent';

export interface NetworkExtension {
  id: string;
  /** From the manifest. */
  userAgent?: string;
  rateLimit?: { perSecond: number };
}

export const GLOBAL_USER_AGENT_KEY = 'network.userAgent';
const DEFAULT_PER_SECOND = 10;
const DEFAULT_MEDIA_PER_SECOND = 30;

export interface NetworkEvents {
  onCloudflare(status: CloudflareStatus): void;
  onOnline(online: boolean): void;
}

/** One fetcher (session, rate limits) per extension, plus the online/offline status. */
export class NetworkManager {
  private readonly fetchers = new Map<string, ExtensionFetcher>();
  private readonly solver: CloudflareSolver;
  readonly status: NetworkStatus;
  private readonly onlineListeners = new Set<(online: boolean) => void>();

  constructor(
    private readonly settings: SettingsRepository,
    events: NetworkEvents,
  ) {
    this.solver = new CloudflareSolver({
      emit: events.onCloudflare,
      userAgentFor: (extensionId) => this.userAgentOf(extensionId),
    });
    this.status = new NetworkStatus((online) => {
      events.onOnline(online);
      for (const listener of this.onlineListeners) listener(online);
    });
  }

  /** Calls `listener` whenever the machine goes on or offline (the downloader and the update checker wait on it). */
  onOnlineChange(listener: (online: boolean) => void): () => void {
    this.onlineListeners.add(listener);
    return () => this.onlineListeners.delete(listener);
  }

  private readonly manifestAgents = new Map<string, string | undefined>();

  private userAgentOf(extensionId: string): string {
    return (
      this.manifestAgents.get(extensionId) ??
      this.settings.getValue<string | null>(GLOBAL_USER_AGENT_KEY, null) ??
      defaultUserAgent(session.fromPartition(`persist:ext-${extensionId}`))
    );
  }

  fetcherFor(extension: NetworkExtension): ExtensionFetcher {
    let fetcher = this.fetchers.get(extension.id);
    if (!fetcher) {
      this.manifestAgents.set(extension.id, extension.userAgent);
      fetcher = new ExtensionFetcher({
        extensionId: extension.id,
        session: session.fromPartition(`persist:ext-${extension.id}`),
        perSecond: extension.rateLimit?.perSecond ?? DEFAULT_PER_SECOND,
        mediaPerSecond: DEFAULT_MEDIA_PER_SECOND,
        userAgent: () => this.userAgentOf(extension.id),
        solver: this.solver,
        isOnline: () => this.status.isOnline,
      });
      this.fetchers.set(extension.id, fetcher);
    }
    return fetcher;
  }

  /** Drops the fetcher (its limits came from the old manifest). The session and its cookies stay. */
  invalidate(extensionId: string): void {
    this.fetchers.delete(extensionId);
    this.manifestAgents.delete(extensionId);
  }

  /** Opens the challenge window for a request the user asked to verify. */
  verify(extensionId: string, url: string): Promise<boolean> {
    return this.solver.solve(extensionId, url);
  }
}
