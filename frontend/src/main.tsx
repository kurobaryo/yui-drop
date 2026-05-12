/**
 * Entry point.
 *
 * Wires up:
 *   - StrictMode (dev-only sanity checks)
 *   - React.Suspense (for i18n + lazy chunks)
 *   - QueryClientProvider (TanStack Query)
 *   - i18n side-effect import (initialises i18next)
 *   - global stylesheet
 */
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Side-effect: configures i18next + react-i18next.
import './i18n';
// Side-effect: tokens + tailwind + base styles.
import './styles/global.css';

import App from './App';

// Sensible defaults: don't refetch on focus for a self-hosted file-share
// tool — the data isn't time-critical, and refetches feel jittery.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Yui-Drop: #root element missing from index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense
        fallback={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '100vh',
              color: 'var(--text-2)',
              fontSize: 14,
            }}
          >
            Loading…
          </div>
        }
      >
        <App />
      </Suspense>
    </QueryClientProvider>
  </StrictMode>,
);
