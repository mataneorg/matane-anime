import { loadSource, step } from './run';

export interface TestOptions {
  source?: string;
  query?: string;
  pref: string[];
  verbose?: boolean;
}

/**
 * The chain a user goes through: popular → search → details → episodes → streams, with the same checks
 * the app applies to what the extension returns. Returns the process exit code.
 */
export async function runTest(dir: string, options: TestOptions): Promise<number> {
  const { client, runtime, prefs, call, sourceKey, host } = await loadSource(dir, {
    source: options.source,
    prefs: options.pref,
    verbose: options.verbose,
  });
  let failures = 0;
  const check = <T>(result: { ok: true; value: T } | { ok: false }): T | undefined => {
    if (!result.ok) failures++;
    return result.ok ? result.value : undefined;
  };

  try {
    console.log(`source ${runtime.manifest.id}/${sourceKey}  prefs ${JSON.stringify(prefs)}\n`);
    const popular = check(
      await step(
        'getPopular(1)',
        () => client.getPopular(1, call),
        (p) => `${p.items.length} items, next page: ${p.hasNextPage ? 'yes' : 'no'}`,
      ),
    );
    if (client.supports('getLatest')) {
      check(
        await step(
          'getLatest(1)',
          () => client.getLatest(1, call),
          (p) => `${p.items.length} items`,
        ),
      );
    }
    const filters = check(
      await step(
        'getFilters()',
        () => client.getFilters(call),
        (f) => `${f.length} filters`,
      ),
    );
    void filters;

    const query = options.query ?? popular?.items[0]?.title.split(' ')[0] ?? '';
    const found = check(
      await step(
        `search("${query}", 1)`,
        () => client.search(query, 1, {}, call),
        (p) => `${p.items.length} items`,
      ),
    );

    const anime = found?.items[0] ?? popular?.items[0];
    if (!anime) {
      console.log('\nNothing to open: no anime came back.');
      return 1;
    }
    const details = check(
      await step(
        `getAnimeDetails(${anime.url})`,
        () => client.getAnimeDetails(anime, call),
        (d) => `"${d.title}", ${d.status}, ${d.genres?.length ?? 0} genres`,
      ),
    );
    const episodes = check(
      await step(
        'getEpisodes()',
        () => client.getEpisodes(anime, call),
        (e) => `${e.length} episodes, newest: ${e[0]?.name ?? '-'}`,
      ),
    );
    const episode = episodes?.[0];
    if (episode) {
      check(
        await step(
          `getStreams(${episode.name})`,
          () => client.getStreams(episode, call),
          (streams) =>
            `${streams.length} streams: ${streams.map((s) => `${s.server}${s.quality ? ` ${s.quality}p` : ''}`).join(', ')}`,
        ),
      );
    } else if (details) {
      console.log('\nNo episodes to resolve streams for.');
    }

    if (client.supports('getWebUrl')) {
      check(
        await step(
          'getWebUrl()',
          async () => client.getWebUrl(anime, call),
          (url) => String(url),
        ),
      );
    }
    console.log(
      `\n${host.stats.requests} requests, ${Math.round(host.stats.httpMs)} ms on the network, heap ${(runtime.memoryUsage() / 1048576).toFixed(1)} MB`,
    );
    console.log(failures === 0 ? '\nAll steps passed.' : `\n${failures} step(s) failed.`);
    return failures === 0 ? 0 : 1;
  } finally {
    runtime.dispose();
  }
}
