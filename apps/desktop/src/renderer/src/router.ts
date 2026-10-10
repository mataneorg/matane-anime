import { createHashHistory, createRouter } from '@tanstack/react-router';
import { RouteError, RouteNotFound } from './components/RouteError';
import { routeTree } from './routeTree.gen';

// Hash history: the packaged app loads index.html from disk, where path history does not work.
export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: 'intent',
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: RouteNotFound,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
