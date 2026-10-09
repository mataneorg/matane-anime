import { useQuery } from '@tanstack/react-query';
import { downloadsQuery } from '@renderer/lib/downloads';
import { pendingCount } from './progress';

/** The count for the sidebar badge: downloads running or waiting. */
export function usePendingDownloads(): number {
  const { data } = useQuery(downloadsQuery);
  return pendingCount(data ?? []);
}
