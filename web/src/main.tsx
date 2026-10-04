import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/400-italic.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource-variable/martian-mono/index.css';
import '@fontsource-variable/fraunces/index.css';
import '@xyflow/react/dist/style.css';

import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/source.css';
import './styles/folderPicker.css';
import './styles/workspace.css';
import './styles/navigator.css';
import './styles/structure.css';
import './styles/code.css';
import './styles/inspector.css';
import './styles/graph.css';
import './styles/findings.css';
import './styles/tabs.css';

import { App } from './App';
import { isApiError } from './lib/api';
import { useApiMode } from './state/apiMode';
import { applyTheme, useTheme } from './state/theme';

function onError(error: unknown): void {
  if (isApiError(error) && error.kind === 'unreachable') useApiMode.getState().reportUnreachable();
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (count, error) => !(isApiError(error) && (error.kind === 'unreachable' || error.kind === 'http')) && count < 2,
    },
  },
});

applyTheme(useTheme.getState().pref);

const root = document.getElementById('root');
if (!root) throw new Error('#root bulunamadı');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
