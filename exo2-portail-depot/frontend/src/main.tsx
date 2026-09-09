import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// Inter est empaquetee avec l'application : aucun appel a un CDN de polices
// (pas de dependance externe a l'execution, pas de fuite d'IP des visiteurs).
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import { Provider } from './components/ui/provider';
import { App } from './App';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </Provider>
  </StrictMode>,
);
