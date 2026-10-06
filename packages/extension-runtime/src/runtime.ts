import { createDecipheriv, createHash } from 'node:crypto';
import type { ExtensionManifest } from '@matane-anime/extension-sdk/manifest';
import { manifestSchema } from '@matane-anime/extension-sdk/manifest';
import type { HtmlLoadOptions, HttpRequest, HttpResult } from '@matane-anime/extension-sdk';
import {
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
  RELEASE_SYNC,
  newQuickJSWASMModule,
  newVariant,
  shouldInterruptAfterDeadline,
} from 'quickjs-emscripten';
import { ExtensionRuntimeError, HostError, type SerializedError, serializeError } from './errors';
import { HtmlStore } from './html-store';
import { PRELUDE } from './prelude';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * What the embedder provides. The app backs `http` with the main-process network layer and the CLI backs it
 * with Node's fetch, so one runtime behaves the same in both. `http` is only reached after the runtime has
 * checked the URL is http(s).
 */
export interface HostApi {
  http(request: HttpRequest): Promise<HttpResult>;
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };
  log(level: LogLevel, message: string): void;
}

export interface RuntimeLimits {
  /** QuickJS heap limit. */
  memoryBytes: number;
  /** Longest stretch of synchronous guest code before it is interrupted. */
  syncMs: number;
  /** Budget for one call, including every wait on the host and the network. */
  callTimeoutMs: number;
  /** Per-method overrides: `getEpisodes` may need many requests. */
  methodTimeoutMs: Partial<Record<string, number>>;
}

// docs/PRD.md EXT-2. Confirmed or adjusted by `ma-ext bench` (docs/adr/0010).
export const DEFAULT_LIMITS: RuntimeLimits = {
  memoryBytes: 64 * 1024 * 1024,
  syncMs: 2_000,
  callTimeoutMs: 30_000,
  methodTimeoutMs: { getEpisodes: 60_000 },
};

const WASM_PAGE = 64 * 1024;
/** What every QuickJS module starts with. */
const WASM_INITIAL_BYTES = 16 * 1024 * 1024;

/**
 * `setMemoryLimit` alone is not a limit: in this build `new Array(10000).fill(x)` in a loop reached 150 MB
 * under a 4 MB limit. Each runtime therefore gets its own WASM module whose memory cannot grow past a hard
 * cap, and an allocation beyond it fails inside the sandbox as a catchable "out of memory" (docs/adr/0010).
 */
function hardMemoryCap(memoryBytes: number): number {
  return Math.max(memoryBytes * 2, 48 * 1024 * 1024);
}

const MAX_SLEEP_MS = 30_000;
/** The largest JSON a call may return; anything bigger is an extension bug, not a catalog. */
const MAX_RESULT_BYTES = 32 * 1024 * 1024;
/** The largest binary value crossing the sandbox boundary as a JSON array (keys, IVs, small payloads). */
const MAX_BYTES = 8 * 1024 * 1024;

/** AES decryption for `crypto.aesDecrypt` (key of 16/24/32 bytes; `cbc` and `ctr` need a 16-byte iv). */
export function aesDecrypt(
  data: Uint8Array,
  key: Uint8Array,
  mode: unknown,
  iv: Uint8Array | null,
  padding: boolean,
): Uint8Array {
  if (mode !== 'cbc' && mode !== 'ctr' && mode !== 'ecb') {
    throw new HostError('ExtensionError', `aesDecrypt: mode must be cbc, ctr or ecb, not ${String(mode)}`);
  }
  if (![16, 24, 32].includes(key.byteLength)) {
    throw new HostError('ExtensionError', `aesDecrypt: the key must be 16, 24 or 32 bytes, not ${key.byteLength}`);
  }
  if (mode !== 'ecb' && iv?.byteLength !== 16) {
    throw new HostError('ExtensionError', `aesDecrypt: ${mode} needs a 16-byte iv`);
  }
  try {
    const decipher = createDecipheriv(`aes-${key.byteLength * 8}-${mode}`, key, mode === 'ecb' ? null : iv);
    decipher.setAutoPadding(padding && mode !== 'ctr');
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch (error) {
    throw new HostError('ExtensionError', `aesDecrypt failed: ${(error as Error).message}`);
  }
}

export interface CreateRuntimeOptions {
  /** The bundled `index.js` produced by `ma-ext build`. */
  code: string;
  manifest: ExtensionManifest;
  host: HostApi;
  hostInfo: { appName: string; appVersion: string; apiVersion: number };
  limits?: Partial<RuntimeLimits>;
}

export interface CallOptions {
  /** Current values of the extension preferences, exposed through `prefs.get`. */
  prefs?: Record<string, unknown>;
  timeoutMs?: number;
}

interface Envelope<T> {
  value?: T;
  error?: SerializedError;
}

/** One sandboxed extension. Calls may overlap. */
export class ExtensionRuntime {
  private readonly html = new HtmlStore();
  private readonly deferreds = new Set<QuickJSDeferredPromise>();
  /** Rejects the calls in flight when a pending job dies (interrupt, out of memory). */
  private readonly inFlight = new Set<(error: ExtensionRuntimeError) => void>();
  private prefs: Record<string, unknown> = {};
  private disposed = false;

  private constructor(
    private readonly runtime: QuickJSRuntime,
    private readonly context: QuickJSContext,
    readonly manifest: ExtensionManifest,
    private readonly host: HostApi,
    private readonly limits: RuntimeLimits,
  ) {}

  static async create(options: CreateRuntimeOptions): Promise<ExtensionRuntime> {
    const manifest = manifestSchema.parse(options.manifest);
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    const memory = new WebAssembly.Memory({
      initial: WASM_INITIAL_BYTES / WASM_PAGE,
      maximum: Math.ceil(hardMemoryCap(limits.memoryBytes) / WASM_PAGE),
    });
    const quickjs = await newQuickJSWASMModule(newVariant(RELEASE_SYNC, { wasmMemory: memory }));
    const runtime = quickjs.newRuntime();
    runtime.setMemoryLimit(limits.memoryBytes);
    runtime.setMaxStackSize(1024 * 1024);
    const context = runtime.newContext();
    const instance = new ExtensionRuntime(runtime, context, manifest, options.host, limits);
    try {
      instance.installPrimitives();
      const infos = Object.fromEntries(manifest.sources.map((source) => [source.key, source]));
      instance.evalVoid(
        `Object.defineProperty(globalThis, 'host', { value: Object.freeze(${JSON.stringify(options.hostInfo)}) });` +
          `Object.defineProperty(globalThis, '__sourceInfos', { value: Object.freeze(${JSON.stringify(infos)}) });`,
        'host-info.js',
      );
      instance.evalVoid(PRELUDE, 'prelude.js');
      instance.evalVoid(options.code, `${manifest.id}/index.js`);
      instance.evalVoid(
        "if (!globalThis.__extension || typeof globalThis.__extension.createSource !== 'function') throw new Error('The bundle did not register an extension (does the entry file export default defineExtension(…)?)');",
        'check.js',
      );
    } catch (error) {
      instance.dispose();
      throw error instanceof ExtensionRuntimeError ? error : instance.fromGuestFailure(error);
    }
    return instance;
  }

  /** Calls `source[method](...args)` for a source key and returns its JSON result. */
  async call<T = unknown>(sourceKey: string, method: string, args: unknown[], options: CallOptions = {}): Promise<T> {
    this.assertAlive();
    if (options.prefs) this.prefs = options.prefs;
    const timeoutMs = options.timeoutMs ?? this.limits.methodTimeoutMs[method] ?? this.limits.callTimeoutMs;
    const code = `__call(${JSON.stringify(sourceKey)}, ${JSON.stringify(method)}, ${JSON.stringify(JSON.stringify(args))})`;
    try {
      const json = await this.runPromise(code, timeoutMs, `${method} did not finish within ${timeoutMs / 1000} s`);
      return this.open<T>(json, method);
    } catch (error) {
      // After an interrupt or an out-of-memory the QuickJS heap is not trustworthy: drop it, the app reloads.
      if (error instanceof ExtensionRuntimeError && (error.code === 'interrupted' || error.code === 'memory')) {
        this.dispose();
      }
      throw error;
    }
  }

  /** Whether the source implements an optional method (`getLatest`, `getFilters`, `resolveUrl`, …). */
  supports(sourceKey: string, method: string): boolean {
    this.assertAlive();
    const json = this.evalString(`__supports(${JSON.stringify(sourceKey)}, ${JSON.stringify(method)})`);
    return this.open<boolean>(json, 'supports');
  }

  /** The extension-wide preferences it declares. */
  preferences(): unknown {
    this.assertAlive();
    return this.open<unknown>(this.evalString('__preferences()'), 'preferences');
  }

  /** Bytes the QuickJS heap holds right now. */
  memoryUsage(): number {
    const handle = this.runtime.computeMemoryUsage();
    try {
      const usage = this.context.dump(handle) as { memory_used_size?: number };
      return usage.memory_used_size ?? 0;
    } finally {
      handle.dispose();
    }
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const reject of this.inFlight) reject(new ExtensionRuntimeError('disposed', 'The extension was unloaded'));
    this.inFlight.clear();
    for (const deferred of this.deferreds) deferred.dispose();
    this.deferreds.clear();
    this.html.clear();
    try {
      this.context.dispose();
      this.runtime.dispose();
    } catch {
      // A runtime that died from a memory-limit abort can refuse to dispose; there is nothing left to free.
    }
  }

  // ------------------------------------------------------------------ guest execution

  private assertAlive(): void {
    if (this.disposed) throw new ExtensionRuntimeError('disposed', 'The extension was unloaded');
  }

  private armInterrupt(): void {
    this.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + this.limits.syncMs));
  }

  /** Evaluates code that must not return anything useful (setup). Throws on a guest error. */
  private evalVoid(code: string, filename: string): void {
    this.armInterrupt();
    const result = this.context.evalCode(code, filename);
    if (result.error) {
      const error = this.context.dump(result.error);
      result.error.dispose();
      throw this.fromGuestFailure(error);
    }
    result.value.dispose();
  }

  /** Evaluates a synchronous expression that returns a string. */
  private evalString(code: string): string {
    this.armInterrupt();
    const result = this.context.evalCode(code, 'eval.js');
    if (result.error) {
      const error = this.context.dump(result.error);
      result.error.dispose();
      throw this.fromGuestFailure(error);
    }
    try {
      return this.context.getString(result.value);
    } finally {
      result.value.dispose();
    }
  }

  /** Starts an async guest function and waits for the JSON string it resolves to. */
  private async runPromise(code: string, timeoutMs: number, timeoutMessage: string): Promise<string> {
    this.armInterrupt();
    const started = this.context.evalCode(code, 'call.js');
    if (started.error) {
      const error = this.context.dump(started.error);
      started.error.dispose();
      throw this.fromGuestFailure(error);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: ((error: ExtensionRuntimeError) => void) | undefined;
    const failure = new Promise<never>((_resolve, reject) => {
      abort = reject;
      this.inFlight.add(reject);
      timer = setTimeout(() => reject(new ExtensionRuntimeError('timeout', timeoutMessage)), timeoutMs);
    });
    try {
      const settled = this.context.resolvePromise(started.value);
      started.value.dispose();
      this.pump();
      const result = await Promise.race([settled, failure]);
      if (result.error) {
        const error = this.context.dump(result.error);
        result.error.dispose();
        throw this.fromGuestFailure(error);
      }
      try {
        return this.context.getString(result.value);
      } finally {
        result.value.dispose();
      }
    } finally {
      clearTimeout(timer);
      if (abort) this.inFlight.delete(abort);
      if (this.inFlight.size === 0) this.html.clear();
    }
  }

  /** Runs the jobs the guest has queued (promise reactions). A job that dies fails the calls in flight. */
  private pump(): void {
    if (this.disposed) return;
    this.armInterrupt();
    const result = this.runtime.executePendingJobs();
    if (!result.error) return;
    const error = this.fromGuestFailure(this.context.dump(result.error));
    // quickjs-emscripten 0.32 can hand back the error with a stray context when a job grew WASM memory;
    // disposing it keeps `dispose()` from aborting later (regression test in runtime.test.ts).
    const stray = (result.error as QuickJSHandle & { context?: QuickJSContext }).context;
    result.error.dispose();
    if (stray && stray !== this.context) stray.dispose();
    for (const reject of this.inFlight) reject(error);
  }

  private fromGuestFailure(raw: unknown): ExtensionRuntimeError {
    const info = (raw && typeof raw === 'object' ? raw : { message: String(raw) }) as Partial<SerializedError>;
    return this.classify(info.name, typeof info.message === 'string' ? info.message : String(raw), info.status);
  }

  private classify(name: string | undefined, message: string, status?: number): ExtensionRuntimeError {
    if (/out of memory/i.test(message)) {
      return new ExtensionRuntimeError('memory', `The extension used more than ${this.limits.memoryBytes >> 20} MB`);
    }
    if (/interrupted/i.test(message)) {
      return new ExtensionRuntimeError(
        'interrupted',
        `The extension ran synchronous code for more than ${this.limits.syncMs / 1000} s`,
      );
    }
    return new ExtensionRuntimeError('extension', message, name, status);
  }

  /** Opens the `{ value }` / `{ error }` envelope the prelude returns. */
  private open<T>(json: string, what: string): T {
    if (json.length > MAX_RESULT_BYTES) {
      throw new ExtensionRuntimeError('invalid_result', `${what} returned more than ${MAX_RESULT_BYTES >> 20} MB`);
    }
    const envelope = JSON.parse(json) as Envelope<T>;
    if (envelope.error) {
      const { name, message, status } = envelope.error;
      if (name === 'Unsupported') throw new ExtensionRuntimeError('unsupported', message);
      throw this.classify(name, message, status);
    }
    return envelope.value as T;
  }

  // ------------------------------------------------------------------ host primitives

  private installPrimitives(): void {
    const { context } = this;
    const sync = context.newFunction('__hostSync', (opHandle, argsHandle) => {
      const op = context.getString(opHandle);
      const args = JSON.parse(context.getString(argsHandle)) as unknown[];
      let envelope: Envelope<unknown>;
      try {
        envelope = { value: this.syncOp(op, args) ?? null };
      } catch (error) {
        envelope = { error: serializeError(error) };
      }
      return context.newString(JSON.stringify(envelope));
    });
    context.setProp(context.global, '__hostSync', sync);
    sync.dispose();

    const async = context.newFunction('__hostAsync', (opHandle, argsHandle) => {
      const op = context.getString(opHandle);
      const args = JSON.parse(context.getString(argsHandle)) as unknown[];
      const deferred = context.newPromise();
      this.deferreds.add(deferred);
      void this.asyncOp(op, args)
        .then(
          (value): Envelope<unknown> => ({ value: value ?? null }),
          (error: unknown): Envelope<unknown> => ({ error: serializeError(error) }),
        )
        .then((envelope) => {
          if (this.disposed || !this.deferreds.has(deferred)) return;
          const text = context.newString(JSON.stringify(envelope));
          deferred.resolve(text);
          text.dispose();
          this.deferreds.delete(deferred);
          deferred.dispose();
          this.pump();
        });
      return deferred.handle;
    });
    context.setProp(context.global, '__hostAsync', async);
    async.dispose();
  }

  private syncOp(op: string, args: unknown[]): unknown {
    switch (op) {
      case 'html.load':
        return this.html.load(String(args[0]), (args[1] ?? {}) as HtmlLoadOptions);
      case 'html.select':
        return this.html.select(Number(args[0]), String(args[1]));
      case 'html.selectFirst':
        return this.html.selectFirst(Number(args[0]), String(args[1]));
      case 'html.text':
        return this.html.text(Number(args[0]));
      case 'html.html':
        return this.html.html(Number(args[0]));
      case 'html.attr':
        return this.html.attr(Number(args[0]), String(args[1]));
      case 'html.absUrl':
        return this.html.absUrl(Number(args[0]), String(args[1]));
      case 'url.parse': {
        try {
          const url = new URL(String(args[0]), args[1] === null || args[1] === undefined ? undefined : String(args[1]));
          const { href, protocol, username, password, host, hostname, port, pathname, search, hash, origin } = url;
          return { href, protocol, username, password, host, hostname, port, pathname, search, hash, origin };
        } catch {
          throw new HostError('ExtensionError', `Invalid URL: ${String(args[0])}`);
        }
      }
      case 'prefs.get':
        return this.prefs[String(args[0])] ?? null;
      case 'log':
        this.host.log(args[0] as LogLevel, (args[1] as string[]).join(' '));
        return null;
      case 'crypto.hash':
        return createHash(String(args[0])).update(String(args[1]), 'utf8').digest('hex');
      case 'aes.decrypt':
        return Array.from(
          aesDecrypt(
            bytesOf(args[0]),
            bytesOf(args[1]),
            args[2],
            args[3] === null ? null : bytesOf(args[3]),
            args[4] !== false,
          ),
        );
      case 'base64.encode':
        return Buffer.from(String(args[0]), 'utf8').toString('base64');
      case 'base64.decode':
        return Buffer.from(String(args[0]), 'base64').toString('utf8');
      case 'base64.decodeBytes':
        return Array.from(Buffer.from(String(args[0]), 'base64'));
      case 'base64.encodeBytes':
        return Buffer.from(bytesOf(args[0])).toString('base64');
      case 'utf8.encode':
        return Array.from(Buffer.from(String(args[0]), 'utf8'));
      case 'utf8.decode':
        return Buffer.from(bytesOf(args[0])).toString('utf8');
      default:
        throw new HostError('ExtensionError', `Unknown host operation: ${op}`);
    }
  }

  private async asyncOp(op: string, args: unknown[]): Promise<unknown> {
    switch (op) {
      case 'http.request':
        return this.httpRequest(args[0] as HttpRequest);
      case 'storage.get':
        return this.host.storage.get(String(args[0]));
      case 'storage.set':
        return this.host.storage.set(String(args[0]), args[1]);
      case 'storage.remove':
        return this.host.storage.remove(String(args[0]));
      case 'sleep':
        await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(Number(args[0]), 0), MAX_SLEEP_MS)));
        return null;
      default:
        throw new HostError('ExtensionError', `Unknown host operation: ${op}`);
    }
  }

  private async httpRequest(request: HttpRequest): Promise<HttpResult> {
    let url: URL;
    try {
      url = new URL(String(request.url));
    } catch {
      throw new HostError('ExtensionError', `Not a valid URL: ${String(request.url)}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new HostError('ExtensionError', `Only http and https are allowed, not ${url.protocol}`);
    }
    let response: HttpResult;
    try {
      response = await this.host.http({ ...request, url: url.href });
    } catch (error) {
      if (error instanceof HostError || (error instanceof ExtensionRuntimeError && error.errorName)) throw error;
      throw new HostError('NetworkError', error instanceof Error ? error.message : String(error));
    }
    if (request.throwOnError !== false && response.status >= 400) {
      if (response.status === 404) throw new HostError('NotFoundError', `Not found: ${url.href}`, 404);
      if (response.status === 429) throw new HostError('RateLimitedError', `Rate limited by ${url.host}`, 429);
      throw new HostError('HttpError', `HTTP ${response.status} for ${url.href}`, response.status);
    }
    return response;
  }
}

function bytesOf(value: unknown): Uint8Array {
  if (!Array.isArray(value)) throw new HostError('ExtensionError', 'Expected binary data');
  if (value.length > MAX_BYTES)
    throw new HostError('ExtensionError', 'Binary value is too large for the sandbox boundary');
  return Uint8Array.from(value as number[]);
}
