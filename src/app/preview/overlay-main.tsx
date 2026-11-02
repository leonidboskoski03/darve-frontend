import { createRoot } from 'react-dom/client';
import { OverlayDisplay } from '@/features/overlay-display/index';
import { createOverlayReader, readOverlayLocation } from '@/services/overlay/index';
const path = '/overlay/' + (new URLSearchParams(window.location.search).get('displayId') ?? '');
const entry = readOverlayLocation(window.location.origin + path + window.location.hash);
window.history.replaceState(null, '', path + (entry?.grantId ? '#grantId=' + entry.grantId : ''));
const reader = createOverlayReader({
  origin: 'http://127.0.0.1:3310',
  entry,
  replace: (fragment) => window.history.replaceState(null, '', path + fragment),
});
const root = document.getElementById('root');
if (!root) throw new Error('Acceptance root missing');
createRoot(root).render(<OverlayDisplay reader={reader} />);
reader.start();
if (import.meta.hot) import.meta.hot.dispose(() => reader.dispose());
