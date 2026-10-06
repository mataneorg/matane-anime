import type { EpisodeRow } from '@matane-anime/shared';
import { Link } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Play } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@renderer/components/ui/badge';
import { Cover } from '@renderer/components/Cover';

const ROW = 72; // 64 px row + 8 px gap

/** "Ep 12 · Name", unless the name already says which episode it is. */
export function episodeTitle(episode: EpisodeRow, label: (number: number) => string): string {
  if (episode.number === null || /^\s*(ep(isode)?\b|#?\d)/i.test(episode.name)) return episode.name;
  return `${label(episode.number)} · ${episode.name}`;
}

/**
 * The episodes of one anime. A series can have hundreds, so only the rows in view exist: the page itself
 * (`<main>`) is the scroll container, and the list tells the virtualizer where it starts inside it.
 */
export function EpisodeList({
  episodes,
  sourceId,
  thumbnailUrl,
}: {
  episodes: EpisodeRow[];
  sourceId: string;
  thumbnailUrl: string | null;
}) {
  const { t, i18n } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [margin, setMargin] = useState(0);

  useLayoutEffect(() => {
    const list = listRef.current;
    const scrollElement = list?.closest('main') as HTMLElement | null;
    if (!list || !scrollElement) return;
    setScroller(scrollElement);
    const measure = (): void => {
      setMargin(list.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop);
    };
    measure();
    // The header above the list changes height as its text and tags load.
    const observer = new ResizeObserver(measure);
    observer.observe(scrollElement);
    if (list.parentElement) observer.observe(list.parentElement);
    return () => observer.disconnect();
  }, []);

  // The compiler skips memoizing this component, which is fine: it only renders the rows in view.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: episodes.length,
    getScrollElement: () => scroller,
    estimateSize: () => ROW,
    overscan: 8,
    scrollMargin: margin,
  });
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  return (
    <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }} role="list">
      {virtualizer.getVirtualItems().map((item) => {
        const episode = episodes[item.index];
        if (!episode) return null;
        return (
          <div
            key={episode.id}
            role="listitem"
            className="absolute top-0 left-0 w-full pb-2"
            style={{ height: item.size, transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
          >
            <Link
              to="/watch/$episodeId"
              params={{ episodeId: String(episode.id) }}
              className="flex h-16 items-center gap-4 rounded-xl bg-card pr-4 transition-colors hover:bg-input/60"
            >
              <Cover sourceId={sourceId} url={thumbnailUrl} className="h-16 w-28 shrink-0 rounded-l-xl" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold text-foreground">
                  {episodeTitle(episode, (number) => t('anime.episodeNumber', { number }))}
                </span>
                <span className="truncate text-xs leading-4">
                  {episode.uploadedAt ? dates.format(episode.uploadedAt) : t('anime.episodeFallback')}
                </span>
              </div>
              {episode.variant ? <Badge>{episode.variant}</Badge> : null}
              {episode.sourceMissing ? <Badge tone="warning">{t('anime.missing')}</Badge> : null}
              <Play className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
            </Link>
          </div>
        );
      })}
    </div>
  );
}
