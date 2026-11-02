import { createRoot } from 'react-dom/client';
import { createOverlayReader, readOverlayLocation } from '@/services/overlay/index';
import { environment } from '@/services/config/index';
import { OverlayDisplay } from '@/features/overlay-display/index';

const entry = readOverlayLocation(window.location.href);
// Strip all fragments/query, including invalid input, before mounting or starting any request.
window.history.replaceState(
  null,
  '',
  window.location.pathname + (entry?.grantId ? '#grantId=' + entry.grantId : ''),
);
const reader = createOverlayReader({
  origin: environment.apiOrigin,
  entry,
  replace: (fragment) => window.history.replaceState(null, '', window.location.pathname + fragment),
});
const root = document.getElementById('root');
if (!root) throw new Error('Display root is missing.');
createRoot(root).render(<OverlayDisplay reader={reader} />);
reader.start();
if (import.meta.hot) import.meta.hot.dispose(() => reader.dispose());
