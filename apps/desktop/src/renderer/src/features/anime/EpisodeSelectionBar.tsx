import { useMutation } from '@tanstack/react-query';
import { Check, Download, EyeOff, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { call } from '@renderer/lib/api';
import { enqueueEpisodes, useDownloadMap } from '@renderer/lib/downloads';

/** Floating actions for the selected episodes of an anime. */
export function EpisodeSelectionBar({
  ids,
  total,
  onSelectAll,
  onClear,
}: {
  ids: number[];
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const downloads = useDownloadMap();
  const mark = useMutation({
    mutationFn: (watched: boolean) => call('episodes.markWatched', { episodeIds: ids, watched }),
    onSuccess: onClear,
  });
  return (
    <div
      role="toolbar"
      aria-label={t('anime.selection')}
      className="sticky bottom-5 z-20 mx-auto mb-5 flex w-fit flex-wrap items-center gap-2 rounded-xl border bg-popover px-4 py-3 text-popover-foreground shadow-xl"
    >
      <span className="mr-2 font-semibold text-foreground">{t('anime.selected', { count: ids.length })}</span>
      <Button variant="ghost" size="sm" disabled={ids.length === total} onClick={onSelectAll}>
        {t('library.selectAll')}
      </Button>
      <Button variant="secondary" size="sm" disabled={mark.isPending} onClick={() => mark.mutate(true)}>
        <Check aria-hidden />
        {t('anime.markWatched')}
      </Button>
      <Button variant="secondary" size="sm" disabled={mark.isPending} onClick={() => mark.mutate(false)}>
        <EyeOff aria-hidden />
        {t('anime.markUnwatched')}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          void enqueueEpisodes(ids.filter((id) => !downloads.has(id)));
          onClear();
        }}
      >
        <Download aria-hidden />
        {t('anime.download')}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={t('common.cancel')} onClick={onClear}>
        <X aria-hidden />
      </Button>
    </div>
  );
}
