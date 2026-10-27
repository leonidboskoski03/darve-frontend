import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RealtimeProbe } from './realtime-probe';
import '@/design-system/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing preview root.');
const query = new URLSearchParams(window.location.search);
createRoot(root).render(
  <StrictMode>
    <RealtimeProbe
      displayId={query.get('displayId') ?? ''}
      grantId={query.get('grantId') ?? ''}
      protocol={query.get('protocolVersion') === '2' ? 2 : 1}
    />
  </StrictMode>,
);
