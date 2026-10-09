import { randomUUID } from 'node:crypto';
import type { NetworkTestInput, NetworkTestResult } from '@matane-anime/shared';
import { type Session, app, net, session } from 'electron';
import type { SettingsRepository } from '../db/repositories/settings';
import {
  type NetworkSettings,
  globalUserAgent,
  hostResolverOptions,
  mergeNetworkSettings,
  networkProblem,
  proxyConfig,
  proxyCredentials,
} from './config';
import { runConnectionTest } from './connection-test';
import { migrateLegacyUserAgent } from './legacy-user-agent';
import { answerProxyLogin, setProxyCredentialsProvider } from './proxy-auth';
import type { ProxyPasswordStore } from './proxy-password';
import { REPO_PARTITION } from './repo-fetcher';
import { defaultUserAgent } from './user-agent';

/**
 * Puts the network settings to work: the proxy on every session the app makes requests with, and DNS over HTTPS
 * for the whole app. `config.ts` decides what the values mean; this only hands them to Electron.
 */
export class NetworkApplier {
  private readonly sessions = new Set<Session>();
  private testing: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly settings: SettingsRepository,
    private readonly passwords: ProxyPasswordStore,
  ) {}

  /** Startup: migrate the old User-Agent row, answer proxy logins, then apply. Needs the app to be ready. */
  start(): void {
    migrateLegacyUserAgent(this.settings, this.settings.getAppSettings().userAgent, (userAgent) =>
      this.settings.updateAppSettings({ userAgent }),
    );
    setProxyCredentialsProvider(() => proxyCredentials(this.settings.getAppSettings(), this.passwords.get()));
    // Windows (a Cloudflare challenge, say) ask here; `net.request` asks on the request itself.
    app.on('login', (event, _webContents, _details, authInfo, callback) => {
      if (!authInfo.isProxy) return;
      event.preventDefault();
      answerProxyLogin(authInfo, callback);
    });
    this.track(session.defaultSession);
    this.track(session.fromPartition(REPO_PARTITION));
    this.applyResolver();
  }

  /** A session made later (an extension's) gets the current proxy. */
  track(target: Session): void {
    if (this.sessions.has(target)) return;
    this.sessions.add(target);
    void this.applyProxy(target);
  }

  /** After a setting changed (or the password): every session, and the resolver. */
  async apply(): Promise<void> {
    this.applyResolver();
    await Promise.all([...this.sessions].map((target) => this.applyProxy(target)));
  }

  private async applyProxy(target: Session): Promise<void> {
    await target.setProxy(proxyConfig(this.settings.getAppSettings()));
    // Connections opened before the change would keep going through the old route.
    await target.closeAllConnections();
  }

  private applyResolver(): void {
    app.configureHostResolver(hostResolverOptions(this.settings.getAppSettings()));
  }

  /** The global User-Agent when set and usable (manifest > this > default, see `NetworkManager`). */
  userAgent(): string | null {
    return globalUserAgent(this.settings.getAppSettings().userAgent);
  }

  /**
   * The form's unsaved values over the saved ones. The proxy goes on a throwaway in-memory session, so nothing saved
   * changes. DoH cannot be per session (it is app-wide), so the resolver is switched for the length of the test and
   * put back after it; tests run one at a time for that reason.
   */
  test(input: NetworkTestInput): Promise<NetworkTestResult> {
    const run = this.testing.then(() => this.runTest(input));
    this.testing = run.catch(() => undefined);
    return run;
  }

  private async runTest(input: NetworkTestInput): Promise<NetworkTestResult> {
    const effective: NetworkSettings = mergeNetworkSettings(this.settings.getAppSettings(), input.settings);
    const problem = networkProblem(effective);
    if (problem) return { ok: false, ms: null, error: problem };
    const password = input.proxyPassword === undefined ? this.passwords.get() : input.proxyPassword;
    const credentials = proxyCredentials(effective, password);
    const target = session.fromPartition(`matane-test-${randomUUID()}`);
    try {
      await target.setProxy(proxyConfig(effective));
      app.configureHostResolver(hostResolverOptions(effective));
      const userAgent = globalUserAgent(effective.userAgent) ?? defaultUserAgent(target);
      return await runConnectionTest({
        now: () => Date.now(),
        get: (url, { timeoutMs }) =>
          new Promise((resolve, reject) => {
            const client = net.request({ method: 'HEAD', url, session: target, useSessionCookies: false });
            client.setHeader('user-agent', userAgent);
            const timer = setTimeout(() => {
              client.abort();
              reject(new Error('ERR_TIMED_OUT'));
            }, timeoutMs);
            client.on('login', (authInfo, callback) =>
              authInfo.isProxy && credentials ? callback(credentials.username, credentials.password) : callback(),
            );
            client.on('response', (response) => {
              clearTimeout(timer);
              response.on('data', () => undefined);
              resolve({ status: response.statusCode });
            });
            client.on('error', (error) => {
              clearTimeout(timer);
              reject(error);
            });
            client.end();
          }),
      });
    } finally {
      this.applyResolver();
      await target.closeAllConnections().catch(() => undefined);
    }
  }
}
