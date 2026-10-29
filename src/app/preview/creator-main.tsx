import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { createAppRouter } from '@/routes/router';
import { MotionProvider } from '@/motion/provider';
import CreatorBoundary from '../creator-boundary';
import '@/design-system/styles.css';

// Real route composition with an explicit local API. Browser cases supply labelled synthetic HTTP;
// actual backend acceptance separately runs the regular configured application entry.
const query = new URLSearchParams(window.location.search);
const view = query.get('view');
const path = view === 'integrations' ? '/integrations' : view === 'terms' ? '/terms' : '/authorize';
window.history.replaceState(window.history.state, '', path);
const root = document.getElementById('root');
if (!root) throw new Error('Missing creator acceptance root.');
createRoot(root).render(
  <StrictMode>
    <MotionProvider>
      <CreatorBoundary origin="http://127.0.0.1:3310">
        <RouterProvider router={createAppRouter()} />
      </CreatorBoundary>
    </MotionProvider>
  </StrictMode>,
);
