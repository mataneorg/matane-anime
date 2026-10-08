import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { API_VERSION, manifestSchema } from '@matane-anime/extension-sdk/manifest';
import { VERSION } from './version';

const SOURCE_TEMPLATE = `import '@matane-anime/extension-sdk/globals';
import {
  type AnimeDetails,
  type AnimePage,
  type AnimeSummary,
  type Episode,
  NotFoundError,
  type Stream,
  defineExtension,
} from '@matane-anime/extension-sdk';

// Replace the TODOs. Everything runs in a sandbox: there is no fetch, require or process; use the globals
// http, html, storage, prefs, log, crypto, base64, utf8 and timers (see the types in the SDK).
const BASE_URL = 'https://example.com';

export default defineExtension({
  createSource: ({ lang }) => ({
    baseUrl: BASE_URL,

    async getPopular(page: number): Promise<AnimePage> {
      const url = \`\${BASE_URL}/popular?page=\${page}\`;
      const doc = html.load((await http.get(url)).text, { baseUrl: url });
      // TODO: select the cards of the listing.
      const items = doc.select('.card').map((card): AnimeSummary => ({
        url: card.selectFirst('a')?.attr('href') ?? '',
        title: card.selectFirst('.title')?.text().trim() ?? '',
        thumbnailUrl: card.selectFirst('img')?.absUrl('src'),
      }));
      return { items, hasNextPage: doc.selectFirst('a.next') !== null };
    },

    async search(query: string, page: number): Promise<AnimePage> {
      log.debug('searching', query, 'in', lang);
      // TODO: build the search URL and parse it like getPopular.
      return { items: [], hasNextPage: false };
    },

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      // TODO: fetch BASE_URL + anime.url and read the fields.
      return { ...anime, status: 'unknown' };
    },

    async getEpisodes(_anime: AnimeSummary): Promise<Episode[]> {
      // TODO: newest first. \`number\` may be fractional; \`variant\` is "Sub", "Dub", …
      return [];
    },

    async getStreams(_episode: Episode): Promise<Stream[]> {
      // TODO: resolve the episode page and its embeds down to direct video URLs. Add the headers the site
      // checks (usually Referer); the app sends them for you.
      throw new NotFoundError('getStreams is not implemented yet');
    },
  }),
});
`;

export interface ScaffoldOptions {
  id: string;
  name?: string;
  /** Where to create the folder; default `./<id>`. */
  dir?: string;
  lang?: string;
}

/** Looks for a pnpm workspace above `dir` (extensions made inside the repo link the SDK instead of the registry). */
function inWorkspace(dir: string): boolean {
  for (let current = dirname(resolve(dir)); ; current = dirname(current)) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return true;
    if (dirname(current) === current) return false;
  }
}

export async function scaffold(options: ScaffoldOptions): Promise<string> {
  const target = resolve(options.dir ?? options.id);
  if (existsSync(target)) throw new Error(`${target} already exists`);
  const manifest = {
    id: options.id,
    name:
      options.name ??
      options.id.replace(/(^|-)(\w)/g, (_m, sep: string, ch: string) => `${sep ? ' ' : ''}${ch.toUpperCase()}`),
    version: '0.1.0',
    apiVersion: API_VERSION,
    type: 'anime',
    nsfw: false,
    sources: [{ key: options.lang ?? 'en', lang: options.lang ?? 'en', name: options.name ?? options.id }],
  };
  const parsed = manifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  }

  // The three packages are released together, so the CLI's version is also the SDK's.
  const link = inWorkspace(target) ? 'workspace:*' : `^${VERSION}`;
  await mkdir(join(target, 'src'), { recursive: true });
  await Promise.all([
    writeFile(join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(
      join(target, 'package.json'),
      `${JSON.stringify(
        {
          name: `matane-anime-extension-${options.id}`,
          version: '0.1.0',
          private: true,
          type: 'module',
          scripts: { build: 'ma-ext build', test: 'ma-ext test', bench: 'ma-ext bench', typecheck: 'tsc --noEmit' },
          devDependencies: { '@matane-anime/extension-cli': link, '@matane-anime/extension-sdk': link },
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      join(target, 'tsconfig.json'),
      `${JSON.stringify({ compilerOptions: { target: 'ES2020', lib: ['ES2022'], module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, skipLibCheck: true }, include: ['src'] }, null, 2)}\n`,
    ),
    writeFile(join(target, '.gitignore'), 'node_modules/\ndist/\n'),
    writeFile(join(target, 'src/index.ts'), SOURCE_TEMPLATE),
    writeFile(
      join(target, 'README.md'),
      `# ${manifest.name}\n\nA Matane Anime extension.\n\n\`\`\`sh\nnpx ma-ext build   # bundle into dist/\nnpx ma-ext test    # run popular → details → episodes → streams against the real site\n\`\`\`\n\nLoad the \`dist/\` folder in Matane Anime: Settings → Advanced → Load extension from folder.\n`,
    ),
  ]);
  return target;
}

export async function readPackageName(dir: string): Promise<string | undefined> {
  try {
    return (JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { name?: string }).name;
  } catch {
    return undefined;
  }
}
