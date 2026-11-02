import { lazy, Suspense, type PropsWithChildren } from 'react';
import { loadCreatorBoundary } from '@/features/session-status/index';
const Boundary = lazy(loadCreatorBoundary);
// Existing isolated session fixture entry; product creator authority is composed by routes.
export default function CreatorBoundary({
  origin,
  children,
}: PropsWithChildren<{ origin: string }>) {
  return (
    <Suspense fallback={<p role="status">Checking connection…</p>}>
      <Boundary origin={origin}>{children}</Boundary>
    </Suspense>
  );
}
