import '@fontsource-variable/figtree';
import '@fontsource/jetbrains-mono/500.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import log from 'electron-log/renderer';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import { createQueryClient } from './lib/query';
import { router } from './router';
import './styles.css';
import { ThemeProvider } from './theme/ThemeProvider';

log.errorHandler.startCatching();

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
