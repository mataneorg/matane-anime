import type { StatsRange } from '@matane-anime/shared';
import { queryOptions } from '@tanstack/react-query';
import { ipc } from './ipc';

/** Watch sessions send no change events, so the page reads again whenever it opens (`staleTime: 0`). */
export const statsQuery = (range: StatsRange) =>
  queryOptions({
    queryKey: ['stats', range],
    queryFn: () => ipc.invoke('stats.overview', { range }),
    staleTime: 0,
    retry: false,
  });
