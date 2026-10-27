import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CreatorBoundary from '../creator-boundary';
import { SessionProbe } from './session-probe';
import '@/design-system/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Session fixture root is missing.');
createRoot(root).render(
  <StrictMode>
    <CreatorBoundary origin="http://127.0.0.1:3310">
      <SessionProbe />
    </CreatorBoundary>
  </StrictMode>,
);
