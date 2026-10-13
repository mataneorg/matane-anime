// Takes the screenshots on the docs site (apps/docs/public/img) from the REAL app: it adds an extension repository
// the way a user does, installs extensions from it, fills a library from their real sites, and photographs each
// screen in Mocha and Latte.
// Not part of CI (it needs the network and a display) and not the Playwright suite. Look at every image before you
// commit it: nothing personal may show (paths, proxy settings, names).
//   pnpm --filter @matane-anime/desktop build && pnpm --filter @matane-anime/desktop docs:shots [options]
// Options:  --repo <url>       the extension repository to add (default
//                              https://sikocak221.github.io/anime-extension-source/index.json)
//           --ext a,b          ids of the extensions to install from it; the first source that browses fills the library
//           --themes a,b       flavors to photograph (default mocha,latte)
//           --only a,b         only these screens (names as in the SCENES list below)
//           --anime <n>        how many anime go in the library (default 12)
//           --browse-query <t> what the Browse screen searches for (default Jujutsu Kaisen)
//           --skip a,b         leave out anime whose title contains one of these words (case-insensitive); the
//                              Popular list is not vetted, so look at the photographs and add what must not show
//           --out <dir>        where the images go (default apps/docs/public/img), as WebP via ImageMagick
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ElectronApplication, type Page, _electron as electron } from '@playwright/test';

const HERE = import.meta.dirname;
const DESKTOP = resolve(HERE, '..');
const REPO = resolve(DESKTOP, '../..');

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const REPO_URL = option('repo') ?? 'https://sikocak221.github.io/anime-extension-source/index.json';
const EXT_IDS = (option('ext') ?? 'samehadaku,otakudesu,kuramanime').split(',').filter(Boolean);
const THEMES = (option('themes') ?? 'mocha,latte').split(',').filter(Boolean);
const ONLY = option('only')?.split(',').filter(Boolean);
const ANIME = Math.max(3, Number(option('anime') ?? 12));
const SKIP = (option('skip') ?? 'hitozuma,nukitashi,ecchi,hentai').toLowerCase().split(',').filter(Boolean);
const OUT = resolve(option('out') ?? resolve(REPO, 'apps/docs/public/img'));

const BROWSE_QUERY = option('browse-query') ?? 'Jujutsu Kaisen';

const WIDTH = 1280;
const HEIGHT = 800;

let app!: ElectronApplication;
let page!: Page;
const downloads = mkdtempSync(join(tmpdir(), 'matane-shots-dl-'));

const invoke = <T = unknown,>(channel: string, input?: unknown): Promise<T> =>
  page.evaluate(
    ([c, i]) =>
      (window as unknown as { api: { invoke(c: string, i?: unknown): Promise<unknown> } }).api.invoke(c as string, i),
    [channel, input] as const,
  ) as Promise<T>;

const go = async (hash: string): Promise<void> => {
  await page.evaluate((value) => {
    window.location.hash = value;
  }, hash);
};

async function launch(): Promise<void> {
  const userData = mkdtempSync(join(tmpdir(), 'matane-shots-'));
  const launchArgs = [DESKTOP, `--user-data-dir=${userData}`, '--force-prefers-reduced-motion'];
  if (process.env['MATANE_E2E_NO_SANDBOX'] === '1') launchArgs.push('--no-sandbox');
  app = await electron.launch({
    args: launchArgs,
    env: { ...process.env, ELECTRON_RENDERER_URL: '' } as Record<string, string>,
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.setContentSize(w!, h!);
      win.center();
    },
    [WIDTH, HEIGHT],
  );
  await page.waitForTimeout(800);
}

/** Waits until the covers on screen have loaded, so a photograph is not full of grey boxes. */
async function settle(extra = 900): Promise<void> {
  await page
    .waitForFunction(() => [...document.images].every((image) => image.complete), undefined, {
      timeout: 12_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(extra);
}

let theme = 'mocha';
let taken = 0;
const scratch = mkdtempSync(join(tmpdir(), 'matane-shots-png-'));

/** Paths of this computer never reach a photograph: they are swapped for neutral ones in the page first. */
async function hidePaths(): Promise<void> {
  await page.evaluate(
    ([swaps]) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        let text = node.nodeValue ?? '';
        for (const [from, to] of swaps!) text = text.split(from!).join(to!);
        if (text !== node.nodeValue) node.nodeValue = text;
      }
    },
    [
      [
        [downloads, '~/Documents/Matane Anime'],
        [tmpdir(), '~'],
      ],
    ] as const,
  );
}

async function shot(name: string): Promise<void> {
  if (ONLY && !ONLY.some((o) => name === o || name.startsWith(`${o}-`))) return;
  mkdirSync(OUT, { recursive: true });
  await hidePaths();
  const png = join(scratch, `${name}.${theme}.png`);
  await page.screenshot({ path: png });
  // WebP at 1280 px wide keeps a screen near 60 KB where the PNG is a megabyte of covers.
  const made = spawnSync('magick', [png, '-resize', '1280x', '-quality', '82', join(OUT, `${name}.${theme}.webp`)]);
  if (made.status !== 0) throw new Error(`ImageMagick (magick) could not convert ${name}: ${made.stderr}`);
  taken += 1;
  console.log(`  ${name}.${theme}.webp`);
}

async function setTheme(flavor: string): Promise<void> {
  theme = flavor;
  await invoke('settings.set', { theme: flavor, amoled: false });
  await page.waitForTimeout(500);
}

// ------------------------------------------------------------------ extensions

interface SourceInfo {
  id: string;
  extensionId: string;
  available: boolean;
}
interface AnimeItem {
  animeId: number;
  title: string;
}
interface EpisodeItem {
  id: number;
  number: number | null;
}

interface RepoInfo {
  id: number;
}
interface Preparation {
  token: string;
}

/** The user's way in: Browse, Extensions, Add repository, paste the address, check, add, install. */
async function repoFlow(): Promise<void> {
  await go('#/browse/extensions');
  await settle();
  await page
    .getByRole('button', { name: /add repository/i })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill(REPO_URL);
  await dialog.getByRole('button', { name: /check repository/i }).click();
  await page.waitForTimeout(4000);
  await shot('add-repository-checked');
  await dialog.getByRole('button', { name: /^add repository$/i }).click();
  await page.waitForTimeout(2500);

  await page.getByRole('tab', { name: /^available/i }).click();
  await settle(1500);
  await shot('extensions-available');

  // The install dialog of the first extension: checked, but not confirmed.
  const first = EXT_IDS[0]!;
  const available = await invoke<{ id: string; name: string }[]>('extensions.available');
  const name = available.find((e) => e.id === first)?.name ?? first;
  await page.getByRole('button', { name: new RegExp(`^install ${name}$`, 'i') }).click();
  await page.waitForTimeout(5000);
  await shot('extension-install');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  const [repo] = await invoke<RepoInfo[]>('repos.list');
  for (const id of EXT_IDS) {
    const prepared = await invoke<Preparation>('extensions.prepareInstall', { repoId: repo!.id, extensionId: id });
    await invoke('extensions.install', { token: prepared.token });
  }

  // The installs above went around the page; a reload makes it read what is there now.
  await page.reload();
  await page.waitForSelector('nav', { timeout: 30_000 });
  await go('#/browse/extensions');
  await settle();
  await page
    .getByRole('button', { name: /^repositories$/i })
    .first()
    .click();
  await page
    .getByText(/\d+ extensions/)
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => undefined);
  await settle(800);
  await shot('repositories');
  // Leaving the page closes the panel.
  await go('#/library');
}

/** Undoes `repoFlow`, so the next flavor photographs the same steps from the start. */
async function repoReset(): Promise<void> {
  for (const id of EXT_IDS) await invoke('extensions.uninstall', { extensionId: id });
  for (const repo of await invoke<RepoInfo[]>('repos.list')) await invoke('repos.remove', { id: repo.id });
  // The installs above went around the page; a reload makes it read what is there now.
  await page.reload();
  await page.waitForSelector('nav', { timeout: 30_000 });
  await go('#/browse/extensions');
  await settle();
  await page
    .getByRole('button', { name: /^repositories$/i })
    .first()
    .click();
  await page
    .getByText(/\d+ extensions/)
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => undefined);
  await settle(800);
  await shot('repositories');
  // Leaving the page closes the panel.
  await go('#/library');
}

/** The sources of the installed extensions, the first with a usable Popular list. */
async function installedSources(): Promise<{ sourceIds: string[]; main: string; popular: AnimeItem[] }> {
  const sources = await invoke<(SourceInfo & { key: string })[]>('sources.list');
  const sourceIds = sources.filter((s) => EXT_IDS.includes(s.extensionId) && s.available).map((s) => s.id);
  for (const sourceId of sourceIds) {
    const page1 = await invoke<{ items: AnimeItem[] }>('sources.browse', { sourceId, kind: 'popular', page: 1 }).catch(
      () => null,
    );
    if (page1 && page1.items.length >= 6) return { sourceIds, main: sourceId, popular: page1.items };
    console.warn(`  ${sourceId}: Popular gave ${page1?.items.length ?? 'an error'}, trying the next source`);
  }
  throw new Error('no source answered with a list: pass other extensions with --ext');
}

// ------------------------------------------------------------------ the library

interface Seeded {
  animeIds: number[];
  episodes: Map<number, EpisodeItem[]>;
}

/** Adds anime to the library, with a few categories, and fetches their episodes. */
async function seedLibrary(popular: AnimeItem[]): Promise<Seeded> {
  const watching = await invoke<{ id: number }>('categories.create', { name: 'Watching' });
  const later = await invoke<{ id: number }>('categories.create', { name: 'Plan to watch' });
  const seeded: Seeded = { animeIds: [], episodes: new Map() };
  const fit = popular.filter((a) => !SKIP.some((word) => a.title.toLowerCase().includes(word)));
  for (const [index, anime] of fit.slice(0, ANIME).entries()) {
    try {
      const refreshed = await invoke<{ episodes: EpisodeItem[] }>('anime.refresh', { animeId: anime.animeId });
      if (refreshed.episodes.length === 0) continue;
      const categoryIds = index % 3 === 0 ? [watching.id] : index % 3 === 1 ? [later.id] : [];
      await invoke('library.add', { animeId: anime.animeId, categoryIds });
      seeded.animeIds.push(anime.animeId);
      seeded.episodes.set(
        anime.animeId,
        [...refreshed.episodes].sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
      );
      console.log(`  library: ${anime.title} (${refreshed.episodes.length} episodes)`);
    } catch (error) {
      console.warn(`  library: ${anime.title} skipped: ${String((error as Error).message).slice(0, 80)}`);
    }
  }
  if (seeded.animeIds.length < 3) throw new Error('fewer than 3 anime could be added to the library');
  return seeded;
}

/** Watch history, progress and watch sessions, written the way the player writes them. */
async function watchSome(seeded: Seeded): Promise<number | null> {
  let playable: number | null = null;
  for (const animeId of seeded.animeIds.slice(0, 5)) {
    const episodes = seeded.episodes.get(animeId) ?? [];
    for (const [index, episode] of episodes.slice(0, index3(animeId, seeded)).entries()) {
      const session = await invoke<{ playbackId: string }>('playback.start', { episodeId: episode.id }).catch(
        () => null,
      );
      if (!session) break;
      const finished = index < index3(animeId, seeded) - 1 || animeId === seeded.animeIds[0];
      const duration = 24 * 60_000;
      const report = (positionMs: number, reason: string): Promise<unknown> =>
        invoke('watch.progress', {
          playbackId: session.playbackId,
          episodeId: episode.id,
          positionMs,
          durationMs: duration,
          reason,
        });
      await report(0, 'play');
      for (let at = 5000; at <= (finished ? duration * 0.95 : duration * 0.4); at += 5000 * 60) {
        await report(at, 'heartbeat');
      }
      await report(finished ? duration * 0.96 : duration * 0.4, finished ? 'ended' : 'close');
      await invoke('playback.close', { playbackId: session.playbackId }).catch(() => undefined);
      playable ??= episode.id;
    }
  }
  return playable;
}
const index3 = (animeId: number, seeded: Seeded): number => 1 + (seeded.animeIds.indexOf(animeId) % 3);

// ------------------------------------------------------------------ the screens

const settingsSections = ['general', 'library', 'player', 'downloads', 'network', 'data', 'advanced', 'about'];

async function emptyScreens(): Promise<void> {
  await go('#/library');
  await settle();
  await shot('library-empty');
  await go('#/browse/extensions');
  await settle();
  await shot('extensions-empty');
  await page
    .getByRole('button', { name: /add repository/i })
    .first()
    .click()
    .catch(() => undefined);
  await page.waitForTimeout(700);
  await shot('add-repository');
  await page.keyboard.press('Escape');
}

async function onboardingScreens(): Promise<void> {
  const names = ['onboarding-language', 'onboarding-content', 'onboarding-folder', 'onboarding-player'];
  for (const [index, name] of names.entries()) {
    await page.waitForTimeout(500);
    await shot(name);
    const next = page.getByRole('button', { name: index === names.length - 1 ? /start watching/i : /^next$/i });
    await next.click().catch(() => undefined);
  }
}

async function dataScreens(
  sourceIds: string[],
  main: string,
  seeded: Seeded,
  playable: number | null,
  popular: AnimeItem[],
): Promise<void> {
  await go('#/library');
  await settle(1800);
  await shot('library');

  await go('#/browse/extensions');
  await settle();
  await shot('extensions');

  // The Popular list is not vetted; a search for a well-known title shows the same screen without surprises.
  await go(`#/browse/sources/${encodeURIComponent(main)}`);
  await page.waitForTimeout(800);
  const find = page.getByPlaceholder(/search this source/i);
  await find.fill(BROWSE_QUERY).catch(() => undefined);
  await find.press('Enter').catch(() => undefined);
  await settle(2500);
  await shot('browse');

  await go('#/browse/global-search');
  await page.waitForTimeout(600);
  const query = (popular[0]?.title ?? 'anime').split(/\s+/).slice(0, 2).join(' ');
  const box = page.getByPlaceholder(/search every source/i);
  await box.fill(query).catch(() => undefined);
  await box.press('Enter').catch(() => undefined);
  await page.waitForTimeout(9000);
  await settle();
  await shot('global-search');

  const firstAnime = seeded.animeIds[0]!;
  await go(`#/anime/${firstAnime}`);
  await settle(1800);
  await shot('anime');

  await go('#/updates');
  await settle();
  await shot('updates');

  await go('#/history');
  await settle();
  await shot('history');
  await invoke('incognito.set', true);
  await page.waitForTimeout(500);
  await shot('history-incognito');
  await invoke('incognito.set', false);

  await go('#/statistics');
  await settle(1500);
  await shot('statistics');

  if (playable !== null) await playerScreens(playable);

  await downloadScreens(seeded);

  for (const section of settingsSections) {
    await go(`#/settings/${section}`);
    await settle(600);
    await shot(`settings-${section}`);
  }

  await go('#/library');
  await settle(800);
  await page.keyboard.press('Control+K');
  await page.waitForTimeout(700);
  await shot('command-palette');
  await page.keyboard.press('Escape');
  void sourceIds;
}

async function playerScreens(episodeId: number): Promise<void> {
  await go(`#/watch/${episodeId}`);
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const ready = await page
      .evaluate(() => {
        const v = document.querySelector('video');
        return Boolean(v && v.currentTime > 1 && v.videoWidth > 0);
      })
      .catch(() => false);
    if (ready) break;
    await page.waitForTimeout(500);
  }
  // Only the controls are the point; the picture is somebody's work, and a source may stamp its name on it.
  await page.addStyleTag({ content: 'video { visibility: hidden !important; }' });
  await page.mouse.move(WIDTH / 2, HEIGHT / 2);
  await page.waitForTimeout(600);
  await shot('player');
  await page
    .getByRole('button', { name: /^servers$/i })
    .first()
    .click()
    .catch(() => undefined);
  await page.waitForTimeout(700);
  await shot('player-servers');
  await page.keyboard.press('Escape');
  await go('#/library');
}

async function downloadScreens(seeded: Seeded): Promise<void> {
  const ids = [...seeded.episodes.values()].flatMap((list) => list.slice(0, 1).map((e) => e.id)).slice(0, 4);
  await invoke('downloads.enqueue', { episodeIds: ids }).catch(() => undefined);
  await go('#/downloads');
  await page.waitForTimeout(7000);
  await shot('downloads');
  await invoke('downloads.pauseAll').catch(() => undefined);
}

// ------------------------------------------------------------------ main

const SCENES = [
  'onboarding',
  'library-empty',
  'extensions-empty',
  'add-repository',
  'add-repository-checked',
  'repositories',
  'extensions-available',
  'extension-install',
  'library',
  'extensions',
  'browse',
  'global-search',
  'anime',
  'updates',
  'history',
  'history-incognito',
  'statistics',
  'player',
  'player-servers',
  'downloads',
  ...settingsSections.map((s) => `settings-${s}`),
  'command-palette',
];
console.log(`screens: ${SCENES.join(', ')}`);

await launch();
try {
  // 1. A fresh profile: the first-run flow, then the empty states.
  for (const flavor of THEMES) {
    await invoke('settings.set', { onboardingDone: false, theme: flavor });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    theme = flavor;
    await onboardingScreens();
  }
  await invoke('settings.set', {
    onboardingDone: true,
    language: 'en',
    showNsfw: false,
    devMode: false,
    downloadFolder: downloads,
  });
  await page.reload();
  await page.waitForSelector('nav', { timeout: 30_000 });
  for (const [index, flavor] of THEMES.entries()) {
    await setTheme(flavor);
    await emptyScreens();
    await repoFlow();
    if (index < THEMES.length - 1) await repoReset();
  }

  // 2. Real sources, a library and a watch history.
  const { sourceIds, main, popular } = await installedSources();
  console.log(`source: ${main}`);
  const seeded = await seedLibrary(popular);
  const playable = await watchSome(seeded);
  await invoke('updates.check', { scope: { kind: 'all' } }).catch(() => undefined);

  // 3. Every screen, once per flavor.
  for (const flavor of THEMES) {
    console.log(`\n== ${flavor}`);
    await setTheme(flavor);
    await dataScreens(sourceIds, main, seeded, playable, popular);
  }
} finally {
  await invoke('downloads.pauseAll').catch(() => undefined);
  await app.close().catch(() => undefined);
  rmSync(downloads, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`\n${taken} screenshots in ${OUT}`);
