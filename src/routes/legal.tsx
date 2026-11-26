import { Navigate, useLocation } from 'react-router-dom';
import { LegalPage, legalDocumentFromPath } from '@/features/legal/index';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import '@fontsource/syne/700.css';
import '@fontsource/syne/800.css';

export function Component() {
  const { pathname } = useLocation();
  const doc = legalDocumentFromPath(pathname);
  if (!doc) return <Navigate replace to="/privacy" />;
  return <LegalPage document={doc} />;
}
