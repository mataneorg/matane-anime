import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildExtension } from '@matane-anime/extension-cli';
import { type HostApi, ExtensionRuntime, SourceClient } from '@matane-anime/extension-runtime';
import type { HttpRequest, HttpResult } from '@matane-anime/extension-sdk';

const ROOT = join(import.meta.dirname, '..');
export const BASE = 'https://backapi.oploverz.ac/api';

/** A saved page of the real site (test/fixtures); the markup is untouched. */
export const fixture = (name: string): string => readFileSync(join(ROOT, 'test/fixtures', name), 'utf8');

export type Route = (request: HttpRequest) => Partial<HttpResult> | undefined;

export interface Harness {
  client: SourceClient;
  requests: HttpRequest[];
  logs: string[];
  dispose(): void;
}

let built: ReturnType<typeof buildExtension> | undefined;
/** The extension as `ma-ext build` bundles it, so tests run the code that ships, in the sandbox. */
const bundle = (): ReturnType<typeof buildExtension> => (built ??= buildExtension(ROOT, { write: false }));

const live: ExtensionRuntime[] = [];
export const disposeAll = (): void => {
  for (const runtime of live.splice(0)) runtime.dispose();
};

/** Answers from `route`; an unknown URL is a 500 so a missing mock shows up as a failed request. */
export async function load(route: Route): Promise<Harness> {
  const requests: HttpRequest[] = [];
  const logs: string[] = [];
  const host: HostApi = {
    http: async (request) => {
      requests.push(request);
      const answer = route(request);
      return { status: 500, url: request.url, headers: {}, text: '', ...answer };
    },
    storage: { get: async () => null, set: async () => undefined, remove: async () => undefined },
    log: (level, message) => void logs.push(`${level}: ${message}`),
  };
  const { code, manifest } = await bundle();
  const runtime = await ExtensionRuntime.create({
    code,
    manifest,
    host,
    hostInfo: { appName: 'tests', appVersion: '0.0.0', apiVersion: 1 },
  });
  live.push(runtime);
  const client = SourceClient.forRuntime(runtime, 'id');
  return { client, requests, logs, dispose: () => runtime.dispose() };
}

/** A route serving fixtures by exact URL. */
export const pages =
  (table: Record<string, string>): Route =>
  (request) => {
    const text = table[request.url];
    return text === undefined ? undefined : { status: 200, text };
  };
