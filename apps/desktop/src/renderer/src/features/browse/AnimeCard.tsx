import type { CatalogAnime } from '@matane-anime/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Cover } from '@renderer/components/Cover';
import { prefetchAnime } from '@renderer/lib/catalog';

/** How long the pointer rests on a card before its anime is fetched ahead. */
const HOVER_INTENT_MS = 350;

export function AnimeCard({ anime }: { anime: CatalogAnime }) {
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
  return (
    <Link
      to="/anime/$animeId"
      params={{ animeId: String(anime.animeId) }}
      className="group flex flex-col gap-2 rounded-xl"
      onPointerEnter={fetchAhead}
      onPointerLeave={cancel}
      onFocus={fetchAhead}
      onBlur={cancel}
    >
      <div className="relative">
        <Cover
          sourceId={anime.sourceId}
          url={anime.thumbnailUrl}
          className="aspect-[2/3] w-full rounded-xl transition-transform group-hover:scale-[1.02]"
        />
        {anime.inLibrary ? (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-xs leading-4 text-white">
            <Check className="size-3" strokeWidth={2} aria-hidden />
            {t('browse.inLibrary')}
          </span>
        ) : null}
      </div>
      <span className="line-clamp-2 text-[13px] leading-[18px] font-semibold text-foreground">{anime.title}</span>
    </Link>
  );
}

export function AnimeCardSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-2" aria-hidden>
      <div className="aspect-[2/3] w-full rounded-xl bg-card" />
      <div className="h-4 w-3/4 rounded bg-card" />
    </div>
  );
}
