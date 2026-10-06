import type { RuntimeErrorCode } from '@matane-anime/extension-runtime/client';
import type { HttpRequest, HttpResult } from '@matane-anime/extension-sdk';
import type { ExtensionManifest } from '@matane-anime/extension-sdk/manifest';

// The messages between main and the extension host (a utilityProcess that runs the QuickJS sandboxes).
// Main sends commands and the host answers; the host asks main for anything that touches the outside
// world (network, storage, logs), because those belong to main.

export interface HostInfo {
  appName: string;
  appVersion: string;
  apiVersion: number;
}

export type HostCommand =
  | { type: 'load'; extensionId: string; code: string; manifest: ExtensionManifest; hostInfo: HostInfo }
  | { type: 'unload'; extensionId: string }
  | {
      type: 'call';
      extensionId: string;
      sourceKey: string;
      method: string;
      args: unknown[];
      prefs: Record<string, unknown>;
      timeoutMs?: number;
    }
  | { type: 'supports'; extensionId: string; sourceKey: string; method: string }
  | { type: 'preferences'; extensionId: string }
  /** Which extensions the host holds, and how much heap each uses (tests and the benchmark). */
  | { type: 'status' };

export interface RpcError {
  code: RuntimeErrorCode;
  message: string;
  /** The name the extension's error carried (`HttpError`, `NotFoundError`, …). */
  errorName?: string;
  status?: number;
}

/** What the host asks main for. */
export type HostCallback =
  | { op: 'http'; request: HttpRequest }
  | { op: 'storage.get'; key: string }
  | { op: 'storage.set'; key: string; value: unknown }
  | { op: 'storage.remove'; key: string }
  | { op: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string };

export interface CallbackError {
  name: string;
  message: string;
  status?: number;
}

export type ToHost =
  | { kind: 'request'; id: number; command: HostCommand }
  | { kind: 'callback-reply'; id: number; ok: true; value: unknown }
  | { kind: 'callback-reply'; id: number; ok: false; error: CallbackError };

export type FromHost =
  | { kind: 'response'; id: number; ok: true; value: unknown }
  | { kind: 'response'; id: number; ok: false; error: RpcError }
  | { kind: 'callback'; id: number; extensionId: string; callback: HostCallback };

export type { HttpResult };
