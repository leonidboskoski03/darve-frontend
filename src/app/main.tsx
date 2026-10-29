import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { createAppRouter } from '@/routes/router';
import { sanitizeOAuthReturn } from '@/services/identity-navigation/index';
import { AppProviders } from './providers';
import '@/design-system/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing.');
const cleanReturn = sanitizeOAuthReturn(window.location.href);
if (cleanReturn) window.history.replaceState(window.history.state, '', cleanReturn);
const router = createAppRouter();

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
