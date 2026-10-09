import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { call } from './api';
import { ipc } from './ipc';
import { localQueryDefaults } from './query';

/** Kept current by the `incognito.changed` event (see routes/__root.tsx). */
export const incognitoQuery = queryOptions({
  queryKey: ['incognito'],
  queryFn: () => ipc.invoke('incognito.get'),
  ...localQueryDefaults,
});

export function useIncognito(): boolean {
  return useQuery(incognitoQuery).data ?? false;
}

export function useSetIncognito() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => call('incognito.set', on),
    onSuccess: (on) => queryClient.setQueryData(incognitoQuery.queryKey, on),
  });
}
