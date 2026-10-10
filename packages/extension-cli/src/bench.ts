import { type HostApi, ExtensionRuntime, HostError } from '@matane-anime/extension-runtime';
import { API_VERSION, type ExtensionManifest } from '@matane-anime/extension-sdk/manifest';
import { dim, bold } from './log.js';
import { loadSource } from './run.js';

const manifest: ExtensionManifest = {
  id: 'bench',
  name: 'Bench',
  version: '1.0.0',
  apiVersion: API_VERSION,
  type: 'anime',
  nsfw: false,
  sources: [{ key: 'en', lang: 'en', name: 'Bench' }],
};

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] as number;
}

interface Row {
  name: string;
  p50: number;
  p95: number;
  heapMb: number;
  note?: string;
}

const HOST_INFO = { appName: 'ma-ext', appVersion: '0.0.0', apiVersion: API_VERSION };

/** A host whose `http` answers instantly with a prepared body: the time measured is the sandbox's. */
function canned(body: string): HostApi {
  return {
    http: async (request) => {
      if (!request.url.startsWith('http')) throw new HostError('NetworkError', 'bad url');
      return { status: 200, url: request.url, headers: {}, text: body };
    },
    storage: { get: async () => null, set: async () => undefined, remove: async () => undefined },
    log: () => undefined,
  };
}

async function synthetic(name: string, code: string, body: string, runs: number): Promise<Row> {
  const times: number[] = [];
  let heap = 0;
  let note: string | undefined;
  for (let i = 0; i < runs; i++) {
    const runtime = await ExtensionRuntime.create({ code, manifest, host: canned(body), hostInfo: HOST_INFO });
    try {
      const started = performance.now();
      await runtime.call('en', 'run', []);
      times.push(performance.now() - started);
      heap = Math.max(heap, runtime.memoryUsage());
    } catch (error) {
      note = `failed: ${(error as Error).message}`;
      break;
    } finally {
      runtime.dispose();
    }
  }
  return { name, p50: percentile(times, 50), p95: percentile(times, 95), heapMb: heap / 1048576, note };
}

const wrap = (method: string): string =>
  `globalThis.__extension = { createSource() { return { run: async () => { ${method} } }; } };`;

/** What it costs to start an extension: a fresh WASM module (its own memory cap) plus the prelude. */
async function creation(runs: number): Promise<Row> {
  const times: number[] = [];
  let heap = 0;
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    const runtime = await ExtensionRuntime.create({
      code: wrap('return 1;'),
      manifest,
      host: canned(''),
      hostInfo: HOST_INFO,
    });
    times.push(performance.now() - started);
    heap = Math.max(heap, runtime.memoryUsage());
    runtime.dispose();
  }
  return { name: 'Creating a runtime', p50: percentile(times, 50), p95: percentile(times, 95), heapMb: heap / 1048576 };
}

/** The synthetic worst cases of docs/adr/0010: a big JSON feed, a big HTML page, and a CPU loop. */
export async function runSynthetic(runs: number): Promise<Row[]> {
  const feed = JSON.stringify({
    episodes: Array.from({ length: 10_000 }, (_, i) => ({
      id: i,
      number: i,
      title: `Episode ${i}`,
      url: `/watch/x/${i}`,
      date: 1_700_000_000_000 + i,
    })),
  });
  const page = `<ul>${Array.from({ length: 3000 }, (_, i) => `<li class="card"><a href="/a/${i}"><img src="/i/${i}.jpg"><h3 class="title">Title ${i}</h3></a></li>`).join('')}</ul>`;
  return [
    await creation(runs),
    await synthetic(
      '10k-episode JSON feed → mapped',
      wrap(
        `const r = await http.get('https://x.test/'); return r.json().episodes.map((e) => ({ url: e.url, name: e.title, number: e.number, uploadedAt: e.date }));`,
      ),
      feed,
      runs,
    ),
    await synthetic(
      '3k-card HTML page, 9k bridge calls',
      wrap(
        `const doc = html.load((await http.get('https://x.test/')).text); return doc.select('li.card').map((c) => ({ url: c.selectFirst('a').attr('href'), title: c.selectFirst('h3.title').text(), thumbnailUrl: c.selectFirst('img').attr('src') }));`,
      ),
      page,
      runs,
    ),
    await synthetic(
      '5M-iteration CPU loop',
      wrap(`let n = 0; for (let i = 0; i < 5e6; i++) n += i % 7; return n;`),
      '',
      runs,
    ),
  ];
}

export async function runChain(
  dir: string,
  options: { source?: string; pref: string[]; runs: number },
): Promise<Row[]> {
  const rows: Row[] = [];
  const samples = new Map<string, { sandbox: number[]; wall: number[]; heap: number }>();
  for (let i = 0; i < options.runs; i++) {
    const { client, runtime, host, call } = await loadSource(dir, { source: options.source, prefs: options.pref });
    try {
      const time = async <T>(name: string, work: () => Promise<T>): Promise<T | undefined> => {
        const before = host.stats.httpMs;
        const started = performance.now();
        try {
          return await work();
        } catch {
          return undefined;
        } finally {
          const wall = performance.now() - started;
          const entry = samples.get(name) ?? { sandbox: [], wall: [], heap: 0 };
          entry.wall.push(wall);
          entry.sandbox.push(Math.max(0, wall - (host.stats.httpMs - before)));
          entry.heap = Math.max(entry.heap, runtime.memoryUsage());
          samples.set(name, entry);
        }
      };
      const popular = await time('getPopular', () => client.getPopular(1, call));
      const anime = popular?.items[0];
      if (!anime) continue;
      await time('getAnimeDetails', () => client.getAnimeDetails(anime, call));
      const episodes = await time('getEpisodes', () => client.getEpisodes(anime, call));
      const episode = episodes?.[0];
      if (episode) await time('getStreams', () => client.getStreams(episode, call));
    } finally {
      runtime.dispose();
    }
  }
  for (const [name, { sandbox, wall, heap }] of samples) {
    rows.push({
      name,
      p50: percentile(sandbox, 50),
      p95: percentile(sandbox, 95),
      heapMb: heap / 1048576,
      note: `wall p95 ${percentile(wall, 95).toFixed(0)} ms`,
    });
  }
  return rows;
}

export function printRows(title: string, rows: Row[]): void {
  console.log(bold(`\n${title}`));
  console.log('| Case | Sandbox time p50 / p95 | Heap | Note |\n|---|---|---|---|');
  for (const row of rows) {
    console.log(
      `| ${row.name} | ${row.p50.toFixed(0)} / ${row.p95.toFixed(0)} ms | ${row.heapMb.toFixed(1)} MB | ${row.note ?? ''} |`,
    );
  }
  console.log(dim('Sandbox time is wall time minus time spent in http; heap is QuickJS used memory after the call.'));
}
