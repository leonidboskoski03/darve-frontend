import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { createAppRouter } from '@/routes/router';
import { sanitizeOAuthReturn } from '@/services/identity-navigation/index';
import { sanitizePaymentReturn } from '@/services/contributions/index';
import { AppProviders } from './providers';
import '@/design-system/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing.');
const cleanReturn = sanitizeOAuthReturn(window.location.href);
if (cleanReturn) window.history.replaceState(window.history.state, '', cleanReturn);
const cleanPaymentReturn = sanitizePaymentReturn(window.location.href);
if (cleanPaymentReturn) window.history.replaceState(null, '', cleanPaymentReturn);
if (
  /^\/account\/payments\/?$/i.test(window.location.pathname) &&
  (window.location.pathname !== '/account/payments' ||
    window.location.search ||
    window.location.hash)
)
  window.history.replaceState(null, '', '/account/payments');
const router = createAppRouter();

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
