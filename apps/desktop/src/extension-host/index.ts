// Runs in a utilityProcess (docs/adr/0010, 0011). Holds one QuickJS sandbox per loaded extension and
// parses HTML for them; asks main for the network, storage and logs. Never touches Electron APIs.
import { ExtensionRuntime, ExtensionRuntimeError, type HostApi, HostError } from '@matane-anime/extension-runtime';
import type { CallbackError, FromHost, HostCallback, HostCommand, RpcError, ToHost } from '../main/extensions/rpc';

/** Idle sandboxes are dropped to free memory; main loads them again on the next call. */
const IDLE_MS = Number(process.env['MATANE_EXT_IDLE_MS']) || 5 * 60_000;

interface Loaded {
  runtime: ExtensionRuntime;
  lastUsed: number;
}
const loaded = new Map<string, Loaded>();
const pendingCallbacks = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
let nextCallback = 1;

const port = process.parentPort;
const send = (message: FromHost): void => port.postMessage(message);

function ask(extensionId: string, callback: HostCallback): Promise<unknown> {
  const id = nextCallback++;
  return new Promise((resolve, reject) => {
    pendingCallbacks.set(id, { resolve, reject });
    send({ kind: 'callback', id, extensionId, callback });
  });
}

function hostApiFor(extensionId: string): HostApi {
  return {
    http: async (request) => (await ask(extensionId, { op: 'http', request })) as Awaited<ReturnType<HostApi['http']>>,
    storage: {
      get: (key) => ask(extensionId, { op: 'storage.get', key }),
      set: async (key, value) => void (await ask(extensionId, { op: 'storage.set', key, value })),
      remove: async (key) => void (await ask(extensionId, { op: 'storage.remove', key })),
    },
    log: (level, message) => void ask(extensionId, { op: 'log', level, message }).catch(() => undefined),
  };
}

function toRpcError(error: unknown): RpcError {
  if (error instanceof ExtensionRuntimeError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.errorName !== undefined && { errorName: error.errorName }),
      ...(error.status !== undefined && { status: error.status }),
    };
  }
  return { code: 'extension', message: error instanceof Error ? error.message : String(error) };
}

function get(extensionId: string): ExtensionRuntime {
  const entry = loaded.get(extensionId);
  if (!entry || entry.runtime.isDisposed) {
    loaded.delete(extensionId);
    throw new ExtensionRuntimeError('not_loaded', `${extensionId} is not loaded in the extension host`);
  }
  entry.lastUsed = Date.now();
  return entry.runtime;
}

async function handle(command: HostCommand): Promise<unknown> {
  switch (command.type) {
    case 'load': {
      loaded.get(command.extensionId)?.runtime.dispose();
      loaded.delete(command.extensionId);
      const runtime = await ExtensionRuntime.create({
        code: command.code,
        manifest: command.manifest,
        host: hostApiFor(command.extensionId),
        hostInfo: command.hostInfo,
      });
      loaded.set(command.extensionId, { runtime, lastUsed: Date.now() });
      return null;
    }
    case 'unload':
      loaded.get(command.extensionId)?.runtime.dispose();
      loaded.delete(command.extensionId);
      return null;
    case 'call':
      return get(command.extensionId).call(command.sourceKey, command.method, command.args, {
        prefs: command.prefs,
        ...(command.timeoutMs !== undefined && { timeoutMs: command.timeoutMs }),
      });
    case 'supports':
      return get(command.extensionId).supports(command.sourceKey, command.method);
    case 'preferences':
      return get(command.extensionId).preferences();
    case 'status':
      return [...loaded].map(([id, { runtime }]) => ({ id, heapBytes: runtime.memoryUsage() }));
  }
}

port.on('message', (event) => {
  const message = event.data as ToHost;
  if (message.kind === 'callback-reply') {
    const waiting = pendingCallbacks.get(message.id);
    pendingCallbacks.delete(message.id);
    if (!waiting) return;
    if (message.ok) waiting.resolve(message.value);
    else waiting.reject(new HostError(asErrorName(message.error), message.error.message, message.error.status));
    return;
  }
  void handle(message.command).then(
    (value) => send({ kind: 'response', id: message.id, ok: true, value: value ?? null }),
    (error: unknown) => send({ kind: 'response', id: message.id, ok: false, error: toRpcError(error) }),
  );
});

function asErrorName(error: CallbackError): ConstructorParameters<typeof HostError>[0] {
  const known = ['NetworkError', 'HttpError', 'CloudflareError', 'RateLimitedError', 'NotFoundError', 'ParseError'];
  return known.includes(error.name) ? (error.name as ConstructorParameters<typeof HostError>[0]) : 'ExtensionError';
}

setInterval(
  () => {
    const limit = Date.now() - IDLE_MS;
    for (const [id, entry] of loaded) {
      if (entry.lastUsed < limit) {
        entry.runtime.dispose();
        loaded.delete(id);
      }
    }
  },
  Math.min(IDLE_MS, 30_000),
).unref();
