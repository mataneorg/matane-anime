// Checks the extensions of the extensions repository against the REAL sites, through the real app: search, details,
// episodes, the streams the app resolves, and whether the player really shows frames. Not part of CI (it needs the
// network and a display) and not the Playwright suite.
//   pnpm --filter @matane-anime/desktop build && pnpm --filter @matane-anime/desktop verify:live [options]
// Options:  --ext-root <dir>   folder with <lang>/<id>/manifest.json (default ../matane-anime-extentions/src)
//           --only a,b         only these extension folders (ids)
//           --skip-build       use the dist/ that is already there
//           --no-node          skip the second pass that runs the extension in Node (raw streams)
//           --all-streams      also open every stream of the episode one by one (switchStream), to see which servers
//                              the app cannot reach, and the quality the app labels each with
//           --anime <n>        check n different anime per source (spread over the Popular list), not just the first
//           --oldest           check the oldest episode as well as the newest
//           --title <text>     take the first search result for this text instead of the first Popular anime
//           --episode <n>      play episode number n instead of the newest one
//           --play-seconds <n> how long to wait for frames (default 25)
//           --out <dir>        where the report goes (default apps/desktop/test-results)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type ElectronApplication, type Page, _electron as electron } from '@playwright/test';

const HERE = import.meta.dirname;
const DESKTOP = resolve(HERE, '..');
const REPO = resolve(DESKTOP, '../..');

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const option = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const EXT_ROOT = resolve(option('ext-root') ?? resolve(REPO, '../matane-anime-extentions/src'));
const ONLY = option('only')?.split(',').filter(Boolean);
const ALL_STREAMS = flag('all-streams');
const OLDEST = flag('oldest');
const TITLE = option('title');
const EPISODE = option('episode') === undefined ? undefined : Number(option('episode'));
const ANIME = Math.max(1, Number(option('anime') ?? 1));
const PLAY_MS = Number(option('play-seconds') ?? 25) * 1000;
const OUT = resolve(option('out') ?? resolve(DESKTOP, 'test-results'));
const SHOTS = resolve(OUT, 'live-shots');

interface StreamRow {
  server: string;
  quality: number | null;
  kind: string;
  status: string;
}
interface Step {
  ok: boolean;
  ms: number;
  error?: string;
}
interface Row {
  ext: string;
  source: string;
  version: string | null;
  loaded: Step;
  browse?: Step & { count?: number };
  search?: Step & { count?: number; query?: string };
  episodes?: Step & { count?: number; picked?: string };
  streams?: Step & {
    list?: StreamRow[];
    withQuality?: number;
    active?: number;
    /** `--all-streams`: what happened when each stream was opened by itself. */
    each?: { server: string; ok: boolean; quality: number | null; error?: string }[];
  };
  oldest?: { picked?: string; streams?: number; withQuality?: number; plays?: boolean; error?: string };
  plays?: Step & { time?: number; width?: number; frames?: number; uiText?: string };
  node?: Step & { list?: { server: string; quality: number | null; kind: string; headers: string[]; host: string }[] };
  notes: string[];
}

const elapsed = (from: number): number => Math.round(performance.now() - from);
const message = (error: unknown): string =>
  String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']*': /, '');
const withTimeout = <T,>(work: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);

async function timed<T>(work: () => Promise<T>): Promise<{ step: Step; value?: T }> {
  const from = performance.now();
  try {
    const value = await work();
    return { step: { ok: true, ms: elapsed(from) }, value };
  } catch (error) {
    return { step: { ok: false, ms: elapsed(from), error: message(error) } };
  }
}

// ------------------------------------------------------------------ the app

let app: ElectronApplication | undefined;
let page: Page | undefined;

async function launch(): Promise<Page> {
  const userData = mkdtempSync(join(tmpdir(), 'matane-live-'));
  const launchArgs = [DESKTOP, `--user-data-dir=${userData}`, '--force-prefers-reduced-motion'];
  if (process.env['MATANE_E2E_NO_SANDBOX'] === '1') launchArgs.push('--no-sandbox');
  app = await electron.launch({
    args: launchArgs,
    env: { ...process.env, ELECTRON_RENDERER_URL: '' } as Record<string, string>,
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await invoke('settings.set', { onboardingDone: true, showNsfw: true });
  await page.reload();
  await page.waitForSelector('nav', { timeout: 30_000 });
  return page;
}

const invoke = <T = unknown,>(channel: string, input?: unknown): Promise<T> =>
  page!.evaluate(
    ([c, i]) =>
      (window as unknown as { api: { invoke(c: string, i?: unknown): Promise<unknown> } }).api.invoke(c as string, i),
    [channel, input] as const,
  ) as Promise<T>;

const go = (hash: string): Promise<void> =>
  page!.evaluate((value) => {
    window.location.hash = value;
  }, hash);

// ------------------------------------------------------------------ the extensions

interface Candidate {
  dir: string;
  id: string;
}
function candidates(): Candidate[] {
  const found: Candidate[] = [];
  for (const lang of readdirSync(EXT_ROOT, { withFileTypes: true })) {
    if (!lang.isDirectory()) continue;
    for (const entry of readdirSync(join(EXT_ROOT, lang.name), { withFileTypes: true })) {
      const dir = join(EXT_ROOT, lang.name, entry.name);
      if (entry.isDirectory() && existsSync(join(dir, 'manifest.json'))) found.push({ dir, id: entry.name });
    }
  }
  return found.filter((c) => !ONLY || ONLY.includes(c.id)).sort((a, b) => a.id.localeCompare(b.id));
}

function build(dir: string): string | null {
  const own = resolve(EXT_ROOT, '../node_modules/.bin/ma-ext');
  const cli = existsSync(own) ? own : resolve(REPO, 'packages/extension-cli/dist/cli.js');
  const run = cli.endsWith('.js')
    ? spawnSync(process.execPath, [cli, 'build', dir], { encoding: 'utf8' })
    : spawnSync(cli, ['build', dir], { encoding: 'utf8' });
  return run.status === 0 ? null : (run.stderr || run.stdout || 'build failed').trim().split('\n').slice(-3).join(' ');
}

interface NodeStreams {
  list: { server: string; quality: number | null; kind: string; headers: string[]; host: string }[];
}
type LoadSource = (
  dir: string,
  options: { source?: string; prefs: string[] },
) => Promise<{
  client: {
    getPopular(page: number, o?: unknown): Promise<{ items: { url: string }[] }>;
    getEpisodes(anime: unknown, o?: unknown): Promise<{ number?: number | null }[]>;
    getStreams(
      episode: unknown,
      o?: unknown,
    ): Promise<{ url: string; server: string; quality?: number; kind?: string; headers?: Record<string, string> }[]>;
  };
  runtime: { dispose(): void };
  call: unknown;
}>;

/** The same extension, run in Node: shows what getStreams returns before the app touches it. */
async function nodePass(loadSource: LoadSource, dir: string, source: string): Promise<NodeStreams> {
  const loaded = await loadSource(dir, { source, prefs: [] });
  try {
    const popular = await loaded.client.getPopular(1, loaded.call);
    const anime = popular.items[0];
    if (!anime) throw new Error('popular is empty');
    const episodes = await loaded.client.getEpisodes(anime, loaded.call);
    const episode = episodes[0];
    if (!episode) throw new Error('no episodes');
    const streams = await loaded.client.getStreams(episode, loaded.call);
    return {
      list: streams.map((s) => ({
        server: s.server,
        quality: s.quality ?? null,
        kind: s.kind ?? 'auto',
        headers: Object.keys(s.headers ?? {}),
        host: new URL(s.url).host,
      })),
    };
  } finally {
    loaded.runtime.dispose();
  }
}

// ------------------------------------------------------------------ one source

interface AnimeItem {
  animeId: number;
  title: string;
}
interface EpisodeItem {
  id: number;
  number: number | null;
  name: string;
  variant: string | null;
}
interface Session {
  playbackId: string;
  streams: StreamRow[];
  activeIndex: number;
}

/** Opens every stream on its own, the way a user picks a server: the app probes it and says whether it answers. */
async function openEach(session: Session): Promise<NonNullable<NonNullable<Row['streams']>['each']>> {
  const each: NonNullable<NonNullable<Row['streams']>['each']> = [];
  for (const [index, stream] of session.streams.entries()) {
    const opened = await timed(() =>
      withTimeout(
        invoke<Session>('playback.switchStream', { playbackId: session.playbackId, index }),
        30_000,
        'switchStream',
      ),
    );
    each.push({
      server: stream.server,
      ok: opened.step.ok,
      quality: opened.value?.streams[index]?.quality ?? stream.quality,
      ...(opened.step.error && { error: opened.step.error }),
    });
  }
  return each;
}

async function checkSource(row: Row, sourceId: string, which = 0): Promise<void> {
  const popular = await timed(() =>
    withTimeout(
      invoke<{ items: AnimeItem[] }>(
        'sources.browse',
        TITLE ? { sourceId, kind: 'search', page: 1, query: TITLE } : { sourceId, kind: 'popular', page: 1 },
      ),
      60_000,
      'popular',
    ),
  );
  row.browse = { ...popular.step, count: popular.value?.items.length };
  const items = popular.value?.items ?? [];
  // 0 is the first of Popular; the others are spread over the list, where older and rarer series sit.
  const first = items[which === 0 ? 0 : Math.min(items.length - 1, Math.floor((items.length * which) / ANIME))];
  if (!first) return;

  const query = first.title.split(/\s+/).slice(0, 2).join(' ');
  const search = await timed(() =>
    withTimeout(
      invoke<{ items: AnimeItem[] }>('sources.browse', { sourceId, kind: 'search', page: 1, query }),
      60_000,
      'search',
    ),
  );
  row.search = { ...search.step, count: search.value?.items.length, query };

  const refreshed = await timed(() =>
    withTimeout(invoke<{ episodes: EpisodeItem[] }>('anime.refresh', { animeId: first.animeId }), 90_000, 'episodes'),
  );
  const episodes = refreshed.value?.episodes ?? [];
  const newest = [...episodes].sort((a, b) => (b.number ?? 0) - (a.number ?? 0))[0];
  const episode = EPISODE === undefined ? newest : (episodes.find((e) => e.number === EPISODE) ?? newest);
  row.episodes = {
    ...refreshed.step,
    count: episodes.length,
    picked: episode
      ? `${first.title} #${episode.number ?? '?'}${episode.variant ? ` (${episode.variant})` : ''}`
      : undefined,
  };
  if (!episode) {
    if (refreshed.step.ok) row.episodes = { ...row.episodes, ok: false, error: 'no episodes' };
    return;
  }

  const started = await timed(() =>
    withTimeout(invoke<Session>('playback.start', { episodeId: episode.id }), 75_000, 'playback.start'),
  );
  const session = started.value;
  row.streams = {
    ...started.step,
    list: session?.streams.map((s) => ({ server: s.server, quality: s.quality, kind: s.kind, status: s.status })),
    withQuality: session?.streams.filter((s) => s.quality !== null).length,
    active: session?.activeIndex,
  };
  if (session && ALL_STREAMS) row.streams.each = await openEach(session);
  if (session) await invoke('playback.close', { playbackId: session.playbackId }).catch(() => undefined);
  if (!started.step.ok) return;

  const watched = await watchFrames(episode.id);
  row.plays = { ok: watched.ok, ms: watched.ms, ...watched.state };
  if (!watched.ok) {
    row.plays.uiText = watched.uiText;
    row.plays.error = watched.uiText ?? 'no frames';
    mkdirSync(SHOTS, { recursive: true });
    await page!.screenshot({ path: join(SHOTS, `${row.ext}-${row.source}.png`) }).catch(() => undefined);
  }

  // `--oldest`: old episodes often sit on other hosts than the newest one.
  const oldest = OLDEST
    ? [...episodes].filter((e) => e.id !== episode.id).sort((a, b) => (a.number ?? 0) - (b.number ?? 0))[0]
    : undefined;
  if (oldest) {
    const first = await timed(() =>
      withTimeout(invoke<Session>('playback.start', { episodeId: oldest.id }), 75_000, 'playback.start'),
    );
    row.oldest = {
      picked: `#${oldest.number ?? '?'}${oldest.variant ? ` (${oldest.variant})` : ''}`,
      ...(first.value && {
        streams: first.value.streams.length,
        withQuality: first.value.streams.filter((s) => s.quality !== null).length,
      }),
      ...(first.step.error && { error: first.step.error }),
    };
    if (first.value) await invoke('playback.close', { playbackId: first.value.playbackId }).catch(() => undefined);
    if (first.step.ok) row.oldest.plays = (await watchFrames(oldest.id)).ok;
  }
  await go('#/library');
}

/** The real player: frames on screen, not just a URL that answered. */
async function watchFrames(episodeId: number): Promise<{
  ok: boolean;
  ms: number;
  state: { time: number; width: number; frames: number };
  uiText?: string;
}> {
  const from = performance.now();
  await go(`#/watch/${episodeId}`);
  let state = { time: 0, width: 0, frames: 0 };
  const deadline = Date.now() + PLAY_MS;
  while (Date.now() < deadline) {
    state = await page!
      .evaluate(() => {
        const v = document.querySelector('video');
        return v
          ? { time: v.currentTime, width: v.videoWidth, frames: v.getVideoPlaybackQuality().totalVideoFrames }
          : { time: 0, width: 0, frames: 0 };
      })
      .catch(() => state);
    if (state.time > 0.8 && state.width > 0 && state.frames > 0) break;
    await page!.waitForTimeout(500);
  }
  const ok = state.time > 0.8 && state.width > 0 && state.frames > 0;
  const uiText = ok
    ? undefined
    : (await page!
        .evaluate(() => {
          const text = document.body.innerText.replace(/\s+/g, ' ').slice(0, 200);
          const v = document.querySelector('video');
          const media = v
            ? ` [video ready=${v.readyState} network=${v.networkState} error=${v.error ? `${v.error.code} ${v.error.message}` : 'none'} src=${(v.currentSrc || v.src).slice(0, 40)}]`
            : ' [no video element]';
          return text + media;
        })
        .catch(() => '')) || undefined;
  return { ok, ms: elapsed(from), state, ...(uiText && { uiText }) };
}

// ------------------------------------------------------------------ the report

const cell = (step?: Step & { count?: number }): string =>
  !step ? '-' : step.ok ? `ok${step.count !== undefined ? ` (${step.count})` : ''}` : 'FAIL';
function markdown(rows: Row[]): string {
  const lines = [
    `# Live check ${new Date().toISOString()}`,
    '',
    '| extension | source | load | browse | search | episodes | streams | with quality | app plays | node | error |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    const error =
      [
        r.loaded.error,
        r.browse?.error,
        r.search?.error,
        r.episodes?.error,
        r.streams?.error,
        r.plays?.error,
        r.node?.error,
      ].find(Boolean) ?? '';
    const quality = r.streams?.list ? `${r.streams.withQuality}/${r.streams.list.length}` : '-';
    const count = r.streams?.list ? ` (${r.streams.list.length})` : '';
    lines.push(
      `| ${r.ext} | ${r.source} | ${cell(r.loaded)} | ${cell(r.browse)} | ${cell(r.search)} | ${cell(r.episodes)} | ${r.streams ? (r.streams.ok ? 'ok' : 'FAIL') : '-'}${count} | ${quality} | ${r.plays ? (r.plays.ok ? 'yes' : 'NO') : '-'} | ${r.node ? (r.node.ok ? `${r.node.list?.length} streams` : 'FAIL') : '-'} | ${error.replace(/\|/g, '/').slice(0, 160)} |`,
    );
  }
  lines.push('', '## Oldest episode (--oldest)', '');
  for (const r of rows) {
    if (!r.oldest) continue;
    lines.push(
      `- **${r.ext}/${r.source}** ${r.oldest.picked ?? ''}: ${r.oldest.error ? `FAIL ${r.oldest.error.slice(0, 140)}` : `${r.oldest.streams} streams, ${r.oldest.withQuality} labelled, plays ${r.oldest.plays ?? '-'}`}`,
    );
  }
  lines.push('', '## Streams', '');
  for (const r of rows) {
    if (r.streams?.each?.length) {
      const bad = r.streams.each.filter((s) => !s.ok);
      lines.push(
        `- **${r.ext}/${r.source}**: ${r.streams.each.length - bad.length}/${r.streams.each.length} streams answer in the app, ${r.streams.each.filter((s) => s.ok && s.quality !== null).length} labelled`,
        ...r.streams.each.map(
          (s) =>
            `  - ${s.ok ? 'ok  ' : 'FAIL'} ${s.server} ${s.quality ?? '?'}p${s.error ? `: ${s.error.slice(0, 140)}` : ''}`,
        ),
      );
      continue;
    }
    if (!r.streams?.list?.length) continue;
    lines.push(
      `- **${r.ext}/${r.source}** (${r.episodes?.picked ?? ''}): ${r.streams.list.map((s) => `${s.server} ${s.quality ?? '?'}p ${s.kind} [${s.status}]`).join(', ')}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

// ------------------------------------------------------------------ main

const list = candidates();
if (list.length === 0) {
  console.error(`no extensions found under ${EXT_ROOT}`);
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
let loadSource: LoadSource | undefined;
if (!flag('no-node')) {
  try {
    loadSource = (await import(pathToFileURL(resolve(REPO, 'packages/extension-cli/dist/run.js')).href))
      .loadSource as LoadSource;
  } catch (error) {
    console.warn(`node pass disabled: ${message(error)}`);
  }
}

const rows: Row[] = [];
const save = (): void => {
  writeFileSync(resolve(OUT, 'live-report.json'), `${JSON.stringify(rows, null, 2)}\n`);
  writeFileSync(resolve(OUT, 'live-report.md'), markdown(rows));
};

for (const candidate of list) {
  console.log(`\n== ${candidate.id}`);
  if (!flag('skip-build')) {
    const failure = build(candidate.dir);
    if (failure) {
      rows.push({
        ext: candidate.id,
        source: '-',
        version: null,
        loaded: { ok: false, ms: 0, error: `build: ${failure}` },
        notes: [],
      });
      console.log(`  build failed: ${failure}`);
      save();
      continue;
    }
  }
  try {
    if (!page || page.isClosed()) await launch();
    const loaded = await timed(() =>
      invoke<{ id: string; status: string; error: string | null; version: string | null; sources: { key: string }[] }>(
        'extensions.loadDevFolder',
        { folder: candidate.dir },
      ),
    );
    const info = loaded.value;
    if (!loaded.step.ok || !info || info.status === 'error') {
      rows.push({
        ext: candidate.id,
        source: '-',
        version: info?.version ?? null,
        loaded: { ok: false, ms: loaded.step.ms, error: loaded.step.error ?? info?.error ?? 'did not load' },
        notes: [],
      });
      save();
      continue;
    }
    const sources = (
      await invoke<{ id: string; extensionId: string; key: string; available: boolean }[]>('sources.list')
    ).filter((s) => s.extensionId === info.id && s.available);
    for (const source of sources) {
      const row: Row = { ext: candidate.id, source: source.key, version: info.version, loaded: loaded.step, notes: [] };
      rows.push(row);
      try {
        await checkSource(row, source.id);
        for (let which = 1; which < ANIME; which++) {
          const extra: Row = {
            ext: row.ext,
            source: row.source,
            version: row.version,
            loaded: row.loaded,
            notes: [`anime ${which + 1} of ${ANIME}`],
          };
          rows.push(extra);
          await checkSource(extra, source.id, which).catch((error) => extra.notes.push(`crashed: ${message(error)}`));
        }
      } catch (error) {
        row.notes.push(`crashed: ${message(error)}`);
        if (page?.isClosed()) {
          await app?.close().catch(() => undefined);
          page = undefined;
        }
      }
      if (loadSource) {
        const node = await timed(() =>
          withTimeout(nodePass(loadSource!, candidate.dir, source.key), 120_000, 'node pass'),
        );
        row.node = { ...node.step, list: node.value?.list };
      }
      console.log(
        `  ${source.key}: streams ${row.streams?.list?.length ?? '-'}, quality ${row.streams?.withQuality ?? '-'}, plays ${row.plays?.ok ?? '-'}${row.plays?.error ? ` (${row.plays.error.slice(0, 80)})` : ''}`,
      );
      save();
    }
  } catch (error) {
    rows.push({
      ext: candidate.id,
      source: '-',
      version: null,
      loaded: { ok: false, ms: 0, error: message(error) },
      notes: [],
    });
    save();
  }
}
await app?.close().catch(() => undefined);
save();
const failed = rows.filter((r) => !r.loaded.ok || (r.plays ? !r.plays.ok : true)).length;
console.log(`\n${rows.length} sources, ${failed} not playing. Report: ${resolve(OUT, 'live-report.md')}`);
process.exit(failed > 0 ? 1 : 0);
