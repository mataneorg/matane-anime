import type { EpisodeRow } from '@matane-anime/shared';
import { ChevronDown, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { enqueueEpisodes, useDownloadMap } from '@renderer/lib/downloads';
import { cn } from '@renderer/lib/utils';
import { type DownloadScope, NEXT_COUNT, pickEpisodes } from './pick';

const SCOPES: DownloadScope[] = ['next', 'unwatched', 'all'];

/** The Download button of an anime page: which of its episodes to queue (BRW-5, DL-1). */
export function DownloadMenu({ episodes }: { episodes: EpisodeRow[] }) {
  const { t } = useTranslation();
  const downloads = useDownloadMap();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }))}>
        <Download className="size-4" strokeWidth={1.75} aria-hidden />
        {t('anime.download')}
        <ChevronDown className="size-4" strokeWidth={1.75} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {SCOPES.map((scope) => {
          const ids = pickEpisodes(episodes, scope, downloads);
          return (
            <DropdownMenuItem key={scope} disabled={ids.length === 0} onSelect={() => void enqueueEpisodes(ids)}>
              <span className="flex-1">{t(`downloads.menu.${scope}`, { count: NEXT_COUNT })}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{ids.length}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
