import { ExtensionRuntimeError } from '@matane-anime/extension-runtime/client';
import type { HttpRequest, HttpResult } from '@matane-anime/extension-sdk';
import { type UtilityProcess, utilityProcess } from 'electron';
import log from 'electron-log/main';
import type { CallbackError, FromHost, HostCallback, HostCommand, ToHost } from './rpc';

export interface HostCallbacks {
  http(extensionId: string, request: HttpRequest): Promise<HttpResult>;
  storage: {
    get(extensionId: string, key: string): unknown;
    set(extensionId: string, key: string, value: unknown): void;
    remove(extensionId: string, key: string): void;
  };
  log(extensionId: string, level: 'debug' | 'info' | 'warn' | 'error', message: string): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/**
 * Main's end of the extension host. The process is forked on first use. If it dies, every call in flight
 * fails with `host_crashed`, `onExit` lets the registry forget what was loaded, and the next call forks a
 * fresh one (docs/PRD.md EXT-1).
 */
export class ExtensionHostClient {
  private child: UtilityProcess | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private readonly modulePath: string;
  private readonly callbacks: HostCallbacks;
  private readonly onExit: () => void;
  /** Bumped on every fork; lets the registry tell which loads belong to the current process. */
  generation = 0;

  constructor(modulePath: string, callbacks: HostCallbacks, onExit: () => void) {
    this.modulePath = modulePath;
    this.callbacks = callbacks;
    this.onExit = onExit;
  }

  get isRunning(): boolean {
    return this.child !== null;
  }

  /** Sends a command and resolves with the host's answer. */
  send(command: HostCommand): Promise<unknown> {
    const child = this.ensure();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.postMessage({ kind: 'request', id, command } satisfies ToHost);
    });
  }

  /** Stops the process (tests, quit). Calls in flight fail as if it had crashed. */
  kill(): void {
    this.child?.kill();
  }

  private ensure(): UtilityProcess {
    if (this.child) return this.child;
    const child = utilityProcess.fork(this.modulePath, [], { serviceName: 'matane-extension-host', stdio: 'pipe' });
    this.generation++;
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => log.debug(`[extension-host] ${String(chunk).trimEnd()}`));
    child.stderr?.on('data', (chunk: Buffer) => log.warn(`[extension-host] ${String(chunk).trimEnd()}`));
    child.on('message', (message: FromHost) => this.receive(child, message));
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      log.warn(`extension host exited (code ${code})`);
      const error = new ExtensionRuntimeError('host_crashed', 'The extension host stopped unexpectedly');
      for (const waiting of this.pending.values()) waiting.reject(error);
      this.pending.clear();
      this.onExit();
    });
    return child;
  }

  private receive(child: UtilityProcess, message: FromHost): void {
    if (message.kind === 'response') {
      const waiting = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (!waiting) return;
      if (message.ok) waiting.resolve(message.value);
      else {
        const { code, message: text, errorName, status } = message.error;
        waiting.reject(new ExtensionRuntimeError(code, text, errorName, status));
      }
      return;
    }
    void this.answer(message.extensionId, message.callback).then(
      (value) => child.postMessage({ kind: 'callback-reply', id: message.id, ok: true, value } satisfies ToHost),
      (error: unknown) =>
        child.postMessage({
          kind: 'callback-reply',
          id: message.id,
          ok: false,
          error: describe(error),
        } satisfies ToHost),
    );
  }

  private async answer(extensionId: string, callback: HostCallback): Promise<unknown> {
    switch (callback.op) {
      case 'http':
        return this.callbacks.http(extensionId, callback.request);
      case 'storage.get':
        return this.callbacks.storage.get(extensionId, callback.key);
      case 'storage.set':
        this.callbacks.storage.set(extensionId, callback.key, callback.value);
        return null;
      case 'storage.remove':
        this.callbacks.storage.remove(extensionId, callback.key);
        return null;
      case 'log':
        this.callbacks.log(extensionId, callback.level, callback.message);
        return null;
    }
  }
}

function describe(error: unknown): CallbackError {
  const named = error as { errorName?: string; status?: number; message?: string };
  return {
    name: named.errorName ?? 'ExtensionError',
    message: error instanceof Error ? error.message : String(error),
    ...(named.status !== undefined && { status: named.status }),
  };
}
