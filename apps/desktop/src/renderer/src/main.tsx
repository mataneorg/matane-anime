import '@fontsource-variable/inter';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { measureCodecSupport } from '@matane-anime/shared';
import log from 'electron-log/renderer';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import { ipc } from './lib/ipc';
import { createQueryClient } from './lib/query';
import { router } from './router';
import './styles.css';
import { ThemeProvider } from './theme/ThemeProvider';

log.errorHandler.startCatching();

// Main cannot ask Chromium what it can decode, so it is told once (PLY-12). A failure only means no ranking.
void ipc
  .invoke(
    'playback.reportCodecs',
    measureCodecSupport((type) => MediaSource.isTypeSupported(type)),
  )
  .catch(() => {});

const queryClient = createQueryClient();

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
