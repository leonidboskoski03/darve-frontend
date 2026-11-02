import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { createAppRouter } from '@/routes/router';
import { sanitizePaymentReturn } from '@/services/contributions/index';
import { AppProviders } from '../providers';
import '@/design-system/styles.css';
import './collection-fixture.css';

// Explicit synthetic browser fixture. Product entries never load this module.
const params = new URLSearchParams(window.location.search);
const view = params.get('view');
const path =
  view === 'public'
    ? '/contribute/' + encodeURIComponent(params.get('publicId') ?? '')
    : view === 'receipt'
      ? '/receipts/' + encodeURIComponent(params.get('checkout') ?? '')
      : view === 'return'
        ? '/payments/return?' +
          new URLSearchParams(
            [...params].filter(([key]) => ['checkout', 'token', 'PayerID', 'status'].includes(key)),
          ).toString()
        : '/receipts';
window.history.replaceState(null, '', path);
const clean = sanitizePaymentReturn(window.location.href);
if (clean) window.history.replaceState(null, '', clean);
const root = document.getElementById('root');
if (!root) throw new Error('Missing contribution acceptance root.');
createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={createAppRouter({ apiOrigin: 'http://127.0.0.1:3310' })} />
      <aside className="collection-fixture-label" aria-label="Synthetic acceptance fixture">
        SYNTHETIC ACCEPTANCE FIXTURE · NO EXTERNAL PAYMENT
      </aside>
    </AppProviders>
  </StrictMode>,
);
