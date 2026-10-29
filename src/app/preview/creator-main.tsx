import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { createAppRouter } from '@/routes/router';
import { MotionProvider } from '@/motion/provider';
import CreatorBoundary from '../creator-boundary';
import '@/design-system/styles.css';
import './collection-fixture.css';

// Real route composition with an explicit local API. Browser cases supply labelled synthetic HTTP;
// actual backend acceptance separately runs the regular configured application entry.
const query = new URLSearchParams(window.location.search);
const view = query.get('view');
const round = query.get('roundId');
const reportingView = ['dashboard', 'history', 'challenge', 'analytics'].includes(view ?? '');
const reportingSearch = new URLSearchParams();
for (const key of ['timeZone', 'fromDate', 'throughDate', 'broadcastId', 'scope', 'status']) {
  if (query.has(key)) reportingSearch.set(key, query.get(key)!);
}
const path = reportingView
  ? (view === 'dashboard'
      ? '/dashboard'
      : view === 'history'
        ? '/challenges'
        : view === 'challenge'
          ? '/challenges/' + encodeURIComponent(query.get('challengeId') ?? '')
          : '/collection/' + encodeURIComponent(round ?? '') + '/analytics') +
    (reportingSearch.size ? '?' + reportingSearch.toString() : '')
  : view === 'review'
    ? '/collection/' +
      encodeURIComponent(round ?? '') +
      '/suggestions' +
      (query.has('filter') ? '?filter=' + encodeURIComponent(query.get('filter')!) : '')
    : view === 'collection'
      ? '/collection' + (round ? '/' + encodeURIComponent(round) : '')
      : view === 'integrations'
        ? '/integrations'
        : view === 'terms'
          ? '/terms'
          : '/authorize';
window.history.replaceState(window.history.state, '', path);
const root = document.getElementById('root');
if (!root) throw new Error('Missing creator acceptance root.');
createRoot(root).render(
  <StrictMode>
    <MotionProvider>
      <CreatorBoundary origin="http://127.0.0.1:3310">
        <RouterProvider router={createAppRouter()} />
        {view === 'collection' || view === 'review' || reportingView ? (
          <aside className="collection-fixture-label" aria-label="Synthetic acceptance fixture">
            {reportingView
              ? 'SYNTHETIC API FIXTURE · NO REAL PAYMENTS'
              : 'SYNTHETIC API FIXTURE · NO LIVE COLLECTION'}
          </aside>
        ) : null}
      </CreatorBoundary>
    </MotionProvider>
  </StrictMode>,
);
