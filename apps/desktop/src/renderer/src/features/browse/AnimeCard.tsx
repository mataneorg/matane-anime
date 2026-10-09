import type { CatalogAnime, LibraryDisplay } from '@matane-anime/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { type CSSProperties, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Cover } from '@renderer/components/Cover';
import { Skeleton } from '@renderer/components/ui/skeleton';
import { prefetchAnime } from '@renderer/lib/catalog';
import { cn } from '@renderer/lib/utils';

/** How long the pointer rests on a card before its anime is fetched ahead. */
const HOVER_INTENT_MS = 350;

/** Columns of at least `coverSize` px; the list is one row per anime. */
export function gridStyle(display: LibraryDisplay, coverSize: number): CSSProperties {
  return {
    gridTemplateColumns: display === 'list' ? 'minmax(0, 1fr)' : `repeat(auto-fill, minmax(${coverSize}px, 1fr))`,
    columnGap: display === 'comfortable' ? 16 : display === 'list' ? 0 : 10,
    rowGap: display === 'comfortable' ? 20 : display === 'list' ? 0 : 10,
  };
}

/** One anime of a source's list, in the four displays of the library: title under or on the cover, cover only, row. */
export function AnimeCard({ anime, display = 'comfortable' }: { anime: CatalogAnime; display?: LibraryDisplay }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cancel = (): void => clearTimeout(timer.current);
  useEffect(() => cancel, []);
  // Only for an anime whose page has never been filled, and only while online.
  const fetchAhead = (): void => {
    cancel();
    if (anime.detailsFetched || !navigator.onLine) return;
    timer.current = setTimeout(() => prefetchAnime(queryClient, anime.animeId), HOVER_INTENT_MS);
  };
  const inLibrary = anime.inLibrary ? (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-ctp-crust/80 px-2 py-0.5 text-[11px] font-medium text-ctp-text backdrop-blur-sm',
        display === 'compact' && 'absolute top-1.5 left-1.5',
        (display === 'comfortable' || display === 'cover') && 'absolute bottom-1.5 left-1.5',
      )}
    >
      <Check className="size-3" strokeWidth={2} aria-hidden />
      {t('browse.inLibrary')}
    </span>
  ) : null;
  const hover = { onPointerEnter: fetchAhead, onPointerLeave: cancel, onFocus: fetchAhead, onBlur: cancel };
  const params = { animeId: String(anime.animeId) };

  if (display === 'list') {
    return (
      <Link
        to="/anime/$animeId"
        params={params}
        title={anime.title}
        className="group flex h-16 min-w-0 items-center gap-3 border-b px-2 transition-colors hover:bg-accent/60"
        {...hover}
      >
        <Cover sourceId={anime.sourceId} url={anime.thumbnailUrl} className="aspect-[2/3] h-12 shrink-0 rounded" />
        <span className="min-w-0 flex-1 truncate font-semibold text-foreground group-hover:text-primary-text">
          {anime.title}
        </span>
        {inLibrary}
      </Link>
    );
  }

  return (
    <Link
      to="/anime/$animeId"
      params={params}
      title={display === 'comfortable' ? undefined : anime.title}
      className="group flex flex-col gap-2 rounded-lg outline-offset-4"
      {...hover}
    >
      <div className="relative overflow-hidden rounded-lg border transition-colors group-hover:border-primary">
        <Cover sourceId={anime.sourceId} url={anime.thumbnailUrl} className="aspect-[2/3] w-full" />
        {inLibrary}
        {display === 'compact' ? (
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 bg-linear-to-t from-ctp-crust/95 via-ctp-crust/90 via-65% to-transparent px-2 pt-6 pb-2"
          >
            <p className="line-clamp-2 text-xs leading-snug font-semibold text-ctp-text">{anime.title}</p>
          </div>
        ) : null}
      </div>
      {display === 'comfortable' ? (
        <span className="line-clamp-2 text-[13px] leading-snug font-semibold text-foreground transition-colors group-hover:text-primary-text">
          {anime.title}
        </span>
      ) : (
        <span className="sr-only">{anime.title}</span>
      )}
    </Link>
  );
}

export function AnimeCardSkeleton({ display = 'comfortable' }: { display?: LibraryDisplay }) {
  if (display === 'list') {
    return (
      <div className="flex h-16 items-center gap-3 border-b px-2" aria-hidden>
        <Skeleton className="aspect-[2/3] h-12 rounded" />
        <Skeleton className="h-3.5 w-1/3" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <Skeleton className="aspect-[2/3] w-full rounded-lg" />
      {display === 'comfortable' ? <Skeleton className="h-4 w-3/4" /> : null}
    </div>
  );
}
