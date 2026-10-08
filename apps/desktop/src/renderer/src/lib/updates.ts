import { queryOptions } from '@tanstack/react-query';
import { call } from './api';
import { localQueryDefaults } from './query';

// New episodes: the list and the sidebar badge. Main emits the `updates` tag after a check; watching or marking an
// episode touches `episodes:<id>` and downloads the `downloads` tag (see `invalidateForTags`).

export const updatesQuery = queryOptions({
  queryKey: ['updates', 'list'],
  queryFn: () => call('updates.list'),
  ...localQueryDefaults,
});

export const updatesCountQuery = queryOptions({
  queryKey: ['updates', 'count'],
  queryFn: () => call('updates.count'),
  ...localQueryDefaults,
});
