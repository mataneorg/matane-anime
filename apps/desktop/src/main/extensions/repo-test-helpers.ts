import {
  type BuildRepoOptions,
  type PublicKey,
  type RepoPackageInput,
  buildRepoFiles,
  sha256Hex,
  signIndex,
} from '@matane-anime/extension-repo';
import type { ExtensionManifest } from '@matane-anime/extension-sdk/manifest';
import type { ExtensionHostClient } from './host-client';
import { type RepoHttp, RepoHttpError } from './repo-http';
import type { HostCommand } from './rpc';

// Test helpers only: an in-memory network serving repositories built with `buildRepoFiles`, and a fake host.

export const REPO_A = 'https://repo-a.test/main/';
export const REPO_B = 'https://repo-b.test/';

export function manifestFor(id: string, overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id,
    name: `Extension ${id}`,
    version: '1.0.0',
    apiVersion: 1,
    type: 'anime',
    nsfw: false,
    sources: [{ key: 'main', lang: 'en', name: 'Main' }],
    ...overrides,
  };
}

/** Not a real PNG; the archive does not look inside the icon. */
export const icon = (seed = 1): Uint8Array => Uint8Array.from({ length: 48 }, (_, i) => (i * 7 + seed) & 0xff);

export function pkg(
  id: string,
  version = '1.0.0',
  options: Partial<ExtensionManifest> & { minAppVersion?: string; code?: string } = {},
): RepoPackageInput {
  const { minAppVersion, code, ...manifest } = options;
  return {
    manifest: manifestFor(id, { version, ...manifest }),
    code: code ?? `globalThis.__extension = { id: ${JSON.stringify(id)}, version: ${JSON.stringify(version)} };`,
    icon: icon(),
    ...(minAppVersion !== undefined && { minAppVersion }),
  };
}

export function repoOptions(packages: RepoPackageInput[], options: Partial<BuildRepoOptions> = {}): BuildRepoOptions {
  return { name: 'Test repo', serial: 1, generatedAt: '2026-01-01T00:00:00Z', packages, ...options };
}

/** `index.json` as plain data, for tests that tamper with it. */
export interface LooseIndex {
  extensions: { id: string; version: string; [field: string]: unknown }[];
  [field: string]: unknown;
}

/** Repositories on the internet, in memory. Files are keyed by their full URL. */
export class FakeNet implements RepoHttp {
  readonly files = new Map<string, Uint8Array>();
  readonly requests: string[] = [];
  offline = false;
  /** Hosts (as in `new URL(url).host`) that do not answer. */
  readonly unreachable = new Set<string>();

  /** Serves a whole repository under `base`, replacing what was there. */
  publish(base: string, options: BuildRepoOptions): Map<string, Uint8Array> {
    this.unpublish(base);
    const files = buildRepoFiles(options);
    for (const [name, bytes] of files) this.files.set(`${base}${name}`, bytes);
    return files;
  }

  unpublish(base: string): void {
    for (const url of [...this.files.keys()]) if (url.startsWith(base)) this.files.delete(url);
  }

  /** Rewrites `index.json` (and re-signs it when a key is given, else drops the signature). */
  mutateIndex(base: string, change: (index: LooseIndex) => void, privateKeyPem?: string): void {
    const index = this.readIndex(base);
    change(index);
    const bytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`, 'utf8');
    this.files.set(`${base}index.json`, bytes);
    if (privateKeyPem) this.files.set(`${base}index.json.sig`, Buffer.from(signIndex(bytes, privateKeyPem), 'utf8'));
    else this.files.delete(`${base}index.json.sig`);
  }

  /** Replaces an archive and makes the index (re-signed) agree with the new bytes. */
  replaceArchive(base: string, id: string, bytes: Uint8Array, privateKeyPem?: string): void {
    this.files.set(`${base}${id}-${this.versionOf(base, id)}.zip`, bytes);
    this.mutateIndex(
      base,
      (index) => {
        const entry = index.extensions.find((candidate) => candidate.id === id) as LooseIndex['extensions'][number];
        entry.sha256 = sha256Hex(bytes);
        entry.size = bytes.length;
      },
      privateKeyPem,
    );
  }

  private readIndex(base: string): LooseIndex {
    return JSON.parse(Buffer.from(this.files.get(`${base}index.json`) as Uint8Array).toString('utf8')) as LooseIndex;
  }

  private versionOf(base: string, id: string): string {
    return this.readIndex(base).extensions.find((entry) => entry.id === id)?.version as string;
  }

  async get(url: string, options: { maxBytes: number }) {
    this.requests.push(url);
    if (this.offline) throw new RepoHttpError('offline', 'You are offline');
    if (this.unreachable.has(new URL(url).host)) throw new RepoHttpError('network', 'connection refused');
    const bytes = this.files.get(url);
    if (!bytes) throw new RepoHttpError('http_404', 'The server answered 404');
    if (bytes.length > options.maxBytes) throw new RepoHttpError('too_large', 'The file is larger than allowed');
    return { status: 200, url, bytes };
  }
}

export interface FakeHost {
  host: ExtensionHostClient;
  /** The code the sandbox holds per extension id. */
  loaded: Map<string, string>;
  sent: HostCommand[];
}

/** An extension host that keeps code in a map; code containing `BROKEN` fails to load. */
export function fakeHost(): FakeHost {
  const loaded = new Map<string, string>();
  const sent: HostCommand[] = [];
  const host = {
    generation: 1,
    isRunning: true,
    send: async (command: HostCommand) => {
      sent.push(command);
      if (command.type === 'load') {
        if (command.code.includes('BROKEN')) throw new Error('the bundle threw while loading');
        loaded.set(command.extensionId, command.code);
      } else if (command.type === 'unload') {
        loaded.delete(command.extensionId);
      } else if (command.type === 'preferences') {
        return [];
      }
      return undefined;
    },
  } as unknown as ExtensionHostClient;
  return { host, loaded, sent };
}

export type { PublicKey };
