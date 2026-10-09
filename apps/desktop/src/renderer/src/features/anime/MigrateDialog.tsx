import type { AnimeDetail, CatalogAnime, SourceInfo } from '@matane-anime/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Search } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cover } from '@renderer/components/Cover';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { useGlobalSearch } from '@renderer/features/search/useGlobalSearch';
import { call } from '@renderer/lib/api';
import { sourcesQuery } from '@renderer/lib/catalog';
import { describeError } from '@renderer/lib/errors';

/**
 * Moving an anime to the same series on another source, keeping what was watched (docs/PRD.md BRW-8):
 * find it in the other sources, see what would carry over by episode number, then confirm.
 */
export function MigrateDialog({
  anime,
  open,
  onOpenChange,
}: {
  anime: AnimeDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('migrate.title')}
        description={t('migrate.description', { title: anime.title })}
        closeLabel={t('common.close')}
        className="w-[min(640px,calc(100vw-48px))]"
      >
        {open ? <Flow anime={anime} close={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Flow({ anime, close }: { anime: AnimeDetail; close: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: sources = [] } = useQuery(sourcesQuery);
  const [draft, setDraft] = useState(anime.title);
  const [query, setQuery] = useState(anime.title);
  const [picked, setPicked] = useState<CatalogAnime | null>(null);

  // Every other source, whatever extension it comes from: the same series is often on a sibling source.
  const others = useMemo(
    () => sources.filter((source) => source.available && source.id !== anime.sourceId),
    [sources, anime.sourceId],
  );
  const { results, done } = useGlobalSearch(others, query, true);

  const preview = useMutation({
    mutationFn: (target: CatalogAnime) =>
      call('library.migratePreview', { fromAnimeId: anime.animeId, toAnimeId: target.animeId }),
  });
  const migrate = useMutation({
    mutationFn: (target: CatalogAnime) =>
      call('library.migrate', { fromAnimeId: anime.animeId, toAnimeId: target.animeId }),
    onSuccess: (result) => {
      close();
      void navigate({ to: '/anime/$animeId', params: { animeId: String(result.animeId) } });
    },
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setQuery(draft.trim());
  };
  const pick = (target: CatalogAnime): void => {
    setPicked(target);
    preview.mutate(target);
  };

  if (picked) {
    const data = preview.data;
    return (
      <div className="flex flex-col gap-4">
        <p className="font-semibold text-foreground">{t('migrate.pickedTitle', { title: picked.title })}</p>
        {preview.isPending ? (
          <p className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('migrate.checking')}
          </p>
        ) : preview.isError ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-4 text-danger-text"
          >
            {describeError(preview.error, t)}
          </p>
        ) : data ? (
          <div className="flex flex-col gap-3">
            <p role="status">
              {data.withProgress === 0
                ? t('migrate.nothingToCarry')
                : t('migrate.summary', { matched: data.matched, total: data.withProgress })}
            </p>
            {data.unmatched.length > 0 ? (
              <div className="rounded-xl border border-ctp-peach/40 bg-ctp-peach/10 p-3">
                <p className="font-semibold text-foreground">
                  {t('migrate.unmatched', { count: data.unmatched.length })}
                </p>
                <p className="text-xs leading-4 text-muted-foreground">
                  {data.unmatched
                    .slice(0, 8)
                    .map((episode) =>
                      episode.number !== null ? t('anime.episodeNumber', { number: episode.number }) : episode.name,
                    )
                    .join(', ')}
                  {data.unmatched.length > 8 ? '…' : ''}
                </p>
              </div>
            ) : null}
            <p className="text-xs leading-4 text-muted-foreground">{t('migrate.note')}</p>
          </div>
        ) : null}
        {migrate.isError ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-4 text-danger-text"
          >
            {describeError(migrate.error, t)}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={() => setPicked(null)} disabled={migrate.isPending}>
            {t('migrate.back')}
          </Button>
          <Button disabled={!data || migrate.isPending} onClick={() => migrate.mutate(picked)}>
            {t('migrate.confirm')}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
        <Input
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t('migrate.search')}
          placeholder={t('migrate.search')}
          className="pl-9"
        />
      </form>
      {others.length === 0 ? (
        <p className="text-muted-foreground">{t('migrate.noOtherSources')}</p>
      ) : (
        <>
          <p role="status" className="flex items-center gap-2 text-xs leading-4">
            {done < others.length ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {t('globalSearch.progress', { done, total: others.length })}
          </p>
          <ul className="flex max-h-96 flex-col gap-3 overflow-y-auto">
            {others.map((source) => (
              <SourceChoices key={source.id} source={source} result={results[source.id]} onPick={pick} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SourceChoices({
  source,
  result,
  onPick,
}: {
  source: SourceInfo;
  result: ReturnType<typeof useGlobalSearch>['results'][string] | undefined;
  onPick: (anime: CatalogAnime) => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-2">
      <span className="text-xs leading-4 font-semibold text-foreground">{source.name}</span>
      {!result ? (
        <span className="text-xs leading-4 text-muted-foreground">{t('globalSearch.searchingSource')}</span>
      ) : result.status === 'error' ? (
        <span className="text-xs leading-4 text-warning-text">{describeError(result.error, t)}</span>
      ) : result.items.length === 0 ? (
        <span className="text-xs leading-4 text-muted-foreground">{t('migrate.noMatch')}</span>
      ) : (
        <div className="flex flex-col gap-1">
          {result.items.slice(0, 5).map((item) => (
            <button
              key={item.animeId}
              type="button"
              onClick={() => onPick(item)}
              className="flex items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 text-left hover:border-input hover:bg-card/70"
            >
              <Cover sourceId={item.sourceId} url={item.thumbnailUrl} className="h-12 w-8 shrink-0 rounded" />
              <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{item.title}</span>
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
