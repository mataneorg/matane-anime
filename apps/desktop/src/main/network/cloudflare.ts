import type { CloudflareStatus } from '@matane-anime/shared';
import { BrowserWindow, session } from 'electron';

const SHOW_AFTER_MS = 10_000;
const GIVE_UP_AFTER_MS = 2 * 60_000;
const POLL_MS = 500;

export interface SolverDeps {
  emit(status: CloudflareStatus): void;
  userAgentFor(extensionId: string): string;
}

/**
 * Passes a Cloudflare challenge the way a browser does (docs/PRD.md NET-5): a hidden window in the
 * extension's own session and User-Agent loads the page; when `cf_clearance` appears the cookie is in the
 * session and the request can be repeated. If it takes longer than ±10 s the window is shown, because the
 * user may have to click. Requests that hit the challenge together wait for the same attempt.
 */
export class CloudflareSolver {
  private readonly active = new Map<string, Promise<boolean>>();

  constructor(private readonly deps: SolverDeps) {}

  solve(extensionId: string, url: string): Promise<boolean> {
    const key = `${extensionId}|${new URL(url).origin}`;
    const running = this.active.get(key);
    if (running) return running;
    const attempt = this.attempt(extensionId, url).finally(() => this.active.delete(key));
    this.active.set(key, attempt);
    return attempt;
  }

  private attempt(extensionId: string, url: string): Promise<boolean> {
    const emit = (state: CloudflareStatus['state']): void => this.deps.emit({ extensionId, state, url });
    const partition = `persist:ext-${extensionId}`;
    const cookies = session.fromPartition(partition).cookies;

    return new Promise<boolean>((resolve) => {
      const window = new BrowserWindow({
        show: false,
        width: 520,
        height: 720,
        title: 'Verify you are human',
        autoHideMenuBar: true,
        webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      window.webContents.setUserAgent(this.deps.userAgentFor(extensionId));
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, target) => {
        if (!/^https?:/i.test(target)) event.preventDefault();
      });

      let finished = false;
      const started = Date.now();
      const finish = (solved: boolean): void => {
        if (finished) return;
        finished = true;
        clearInterval(poll);
        emit(solved ? 'solved' : 'failed');
        if (!window.isDestroyed()) window.destroy();
        resolve(solved);
      };
      let shown = false;
      const poll = setInterval(() => {
        void cookies.get({ url, name: 'cf_clearance' }).then((found) => {
          if (found.length > 0) {
            // Give the page a moment to finish its own redirect before the window goes away.
            setTimeout(() => finish(true), 300);
          } else if (!shown && Date.now() - started > SHOW_AFTER_MS && !window.isDestroyed()) {
            shown = true;
            emit('visible');
            window.show();
          } else if (Date.now() - started > GIVE_UP_AFTER_MS) {
            finish(false);
          }
        });
      }, POLL_MS);
      window.on('closed', () => finish(false));

      emit('solving');
      void window.loadURL(url).catch(() => {
        // A challenge page often interrupts its own load; the cookie poll decides the outcome.
      });
    });
  }
}
