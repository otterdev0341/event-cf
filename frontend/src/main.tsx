import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/noto-sans-thai/400.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/components.css';
import './styles/workspace.css';
import { App } from './app/App';
import { queryClient } from './shared/api/query';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
