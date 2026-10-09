import type { LibraryDisplay, LibraryItem } from '@matane-anime/shared';
import { Link } from '@tanstack/react-router';
import { Check, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Cover } from '@renderer/components/Cover';
import { cn } from '@renderer/lib/utils';
import type { PickEvent } from './selection';

/**
 * One anime of the library (mockup 01), in the four displays: cover with its title under it (comfortable) or on
 * it (compact), the cover alone, or a row. All of them show the unwatched badge and the watched share, and the
 * Continue button on hover.
 */
export function LibraryCard({
  item,
  display = 'comfortable',
  selecting,
  selected,
  onPick,
}: {
  item: LibraryItem;
  display?: LibraryDisplay;
  selecting: boolean;
  selected: boolean;
  /** A click on the card: the page decides whether it opens the anime or changes the selection. */
  onPick: (event: PickEvent) => void;
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
  const continueLabel =
    item.continue === null
      ? ''
      : item.continue.number !== null
        ? t('library.continueEpisode', { number: item.continue.number })
        : t('library.continue');

  // One link in every display and mode, so keyboard focus stays on it when selecting starts. While selecting it
  // acts as the card's checkbox: a click or Space toggles it (the page cancels the navigation).
  const link = (
    <Link
      to="/anime/$animeId"
      params={{ animeId: String(item.animeId) }}
      aria-label={item.title}
      title={display === 'cover' ? item.title : undefined}
      {...(selecting && { role: 'checkbox', 'aria-checked': selected })}
      onClick={onPick}
      onKeyDown={(event) => {
        if (selecting && event.key === ' ') onPick(event);
      }}
      className="absolute inset-0 z-[5] rounded-[inherit] focus-visible:outline-offset-[-2px]"
    />
  );
  const check = selecting ? (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none z-20 flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-ctp-text/80 bg-ctp-crust/60',
        display !== 'list' && 'absolute top-1.5 right-1.5',
        selected && 'border-primary bg-primary text-primary-foreground',
      )}
    >
      {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
    </span>
  ) : null;
  const badge =
    item.unwatched > 0 ? (
      <span
        className={cn(
          'pointer-events-none flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground',
          display !== 'list' && 'absolute top-1.5 left-1.5',
        )}
        title={t('library.unwatched', { count: item.unwatched })}
      >
        {item.unwatched}
      </span>
    ) : null;
  const continueLink =
    !selecting && item.continue ? (
      <Link
        to="/watch/$episodeId"
        params={{ episodeId: String(item.continue.episodeId) }}
        className={cn(
          'z-10 flex items-center justify-center gap-1.5 rounded-lg bg-primary px-2 text-xs font-medium text-primary-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100',
          display === 'list' ? 'relative z-[6] h-8 shrink-0 px-3' : 'absolute right-2 bottom-3 left-2 h-9',
        )}
      >
        <Play className="size-3.5" strokeWidth={2} aria-hidden />
        {continueLabel}
      </Link>
    ) : null;

  if (display === 'list') {
    return (
      <div
        className={cn(
          'group relative flex h-16 min-w-0 items-center gap-3 border-b px-2 transition-colors hover:bg-accent/60',
          selected && 'bg-primary/10',
        )}
      >
        {link}
        {check}
        <Cover
          sourceId={item.sourceId}
          url={item.thumbnailUrl}
          localAnimeId={item.hasLocalCover ? item.animeId : undefined}
          className="aspect-[2/3] h-12 shrink-0 rounded"
        />
        <div className="pointer-events-none min-w-0 flex-1">
          <div className="truncate font-semibold text-foreground transition-colors group-hover:text-primary-text">
            {item.title}
          </div>
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        </div>
        {badge}
        <div className="pointer-events-none relative hidden h-1 w-24 shrink-0 overflow-hidden rounded-full bg-muted sm:block">
          <div className="h-full bg-primary" style={{ width: `${watchedShare}%` }} aria-hidden />
        </div>
        {continueLink}
      </div>
    );
  }

  return (
    <div className="group relative flex flex-col gap-2">
      <div
        className={cn(
          'relative overflow-hidden rounded-lg border transition-colors group-hover:border-primary',
          selected && 'border-primary ring-2 ring-primary',
        )}
      >
        <Cover
          sourceId={item.sourceId}
          url={item.thumbnailUrl}
          localAnimeId={item.hasLocalCover ? item.animeId : undefined}
          className="aspect-[2/3] w-full"
        />
        {link}
        {badge}
        {check}
        {display === 'compact' ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-1 bg-linear-to-t from-ctp-crust/95 via-ctp-crust/90 via-65% to-transparent px-2 pt-6 pb-2"
          >
            <p className="line-clamp-2 text-xs leading-snug font-semibold text-ctp-text">{item.title}</p>
          </div>
        ) : null}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-ctp-crust/60" aria-hidden>
          <div className="h-full bg-primary" style={{ width: `${watchedShare}%` }} />
        </div>
        {continueLink}
      </div>
      {display === 'comfortable' ? (
        <div className="min-w-0">
          <div className="line-clamp-2 text-[13px] leading-snug font-semibold text-foreground transition-colors group-hover:text-primary-text">
            {item.title}
          </div>
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        </div>
      ) : null}
    </div>
  );
}
