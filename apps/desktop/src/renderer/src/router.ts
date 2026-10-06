import { createHashHistory, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

// Hash history: the packaged app loads index.html from disk, where path history does not work.
export const router = createRouter({ routeTree, history: createHashHistory(), defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
