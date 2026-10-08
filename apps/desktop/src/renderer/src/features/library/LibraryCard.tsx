import type { LibraryItem } from '@matane-anime/shared';
import { Link } from '@tanstack/react-router';
import { Check, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Cover } from '@renderer/components/Cover';
import { cn } from '@renderer/lib/utils';

/** One anime of the library (mockup 01): cover, unwatched badge, progress, "Ep N / total · LANG", Continue on hover. */
export function LibraryCard({
  item,
  selecting,
  selected,
  onToggle,
}: {
  item: LibraryItem;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const watchedShare = item.total > 0 ? ((item.total - item.unwatched) / item.total) * 100 : 0;
  const language = item.lang ? item.lang.toUpperCase() : null;
  const subtitle = [
    item.lastEpisode?.number != null
      ? t('library.progress', { number: item.lastEpisode.number, total: item.total })
      : t('library.episodes', { count: item.total }),
    language,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="group relative flex flex-col gap-2">
      <div className="relative">
        <Cover
          sourceId={item.sourceId}
          url={item.thumbnailUrl}
          localAnimeId={item.hasLocalCover ? item.animeId : undefined}
          className={cn('aspect-[2/3] w-full rounded-xl', selected && 'outline-2 outline-offset-2 outline-accent')}
        />
        {selecting ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={item.title}
            onClick={onToggle}
            className="absolute inset-0 z-10 rounded-xl"
          />
        ) : (
          <Link
            to="/anime/$animeId"
            params={{ animeId: String(item.animeId) }}
            aria-label={item.title}
            className="absolute inset-0 rounded-xl"
          />
        )}
        {item.unwatched > 0 ? (
          <span
            className="absolute top-2 left-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-xs leading-4 font-bold text-on-accent"
            title={t('library.unwatched', { count: item.unwatched })}
          >
            {item.unwatched}
          </span>
        ) : null}
        {selecting ? (
          <span
            aria-hidden
            className={cn(
              'absolute top-2 right-2 z-20 flex size-6 items-center justify-center rounded-full border-2 border-white/80 bg-black/50',
              selected && 'border-accent bg-accent text-on-accent',
            )}
          >
            {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
          </span>
        ) : null}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-xl bg-black/40"
          aria-hidden
        >
          <div className="h-full bg-accent" style={{ width: `${watchedShare}%` }} />
        </div>
        {!selecting && item.continue ? (
          <Link
            to="/watch/$episodeId"
            params={{ episodeId: String(item.continue.episodeId) }}
            className="absolute right-2 bottom-3 left-2 z-10 flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-2 text-[13px] font-semibold text-on-accent opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          >
            <Play className="size-3.5" strokeWidth={2} aria-hidden />
            {item.continue.number !== null
              ? t('library.continueEpisode', { number: item.continue.number })
              : t('library.continue')}
          </Link>
        ) : null}
      </div>
      <div className="min-w-0">
        <div className="line-clamp-2 text-[13px] leading-[18px] font-semibold text-foreground">{item.title}</div>
        <div className="truncate text-xs leading-4">{subtitle}</div>
      </div>
    </div>
  );
}
