import { DEFAULT_EPISODE_VIEW, type EpisodeView } from '@matane-anime/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { call } from '@renderer/lib/api';
import { animeQuery } from '@renderer/lib/catalog';
import { notify } from '@renderer/lib/toast';

/**
 * The episode sort and filters of one anime, kept with the anime. A change shows at once and is saved in order, one
 * at a time; the page shows what was chosen until the last save has landed, so a refetch of the anime in between
 * (main announces each save) cannot flip the view back. A failed save returns to what is stored, with a toast.
 */
export function useEpisodeView(
  animeId: number,
  stored: EpisodeView | null | undefined,
): [EpisodeView, (patch: Partial<EpisodeView>) => void] {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = animeQuery(animeId).queryKey;
  const mutationKey = ['anime', animeId, 'episode-view'] as const;
  const [chosen, setChosen] = useState<EpisodeView | null>(null);
  // The same as `chosen`, readable in the middle of a burst of changes (state is only current after a render).
  const latest = useRef<EpisodeView | null>(null);

  const save = useMutation({
    mutationKey,
    scope: { id: `episode-view-${animeId}` },
    mutationFn: (view: EpisodeView) => call('anime.setEpisodeView', { animeId, view }),
    onSuccess: (_result, view) => {
      queryClient.setQueryData(queryKey, (current) => current && { ...current, episodeView: view });
    },
    onError: () => {
      notify.error(t('anime.viewSaveFailed'));
      void queryClient.invalidateQueries({ queryKey });
    },
    onSettled: () => {
      // Still counts itself here; nothing else waiting means the stored view is the newest one.
      if (queryClient.isMutating({ mutationKey }) <= 1) {
        latest.current = null;
        setChosen(null);
      }
    },
  });

  const change = (patch: Partial<EpisodeView>): void => {
    const base = latest.current ?? queryClient.getQueryData(queryKey)?.episodeView ?? DEFAULT_EPISODE_VIEW;
    const next = { ...base, ...patch };
    latest.current = next;
    setChosen(next);
    save.mutate(next);
  };
  return [chosen ?? stored ?? DEFAULT_EPISODE_VIEW, change];
}
