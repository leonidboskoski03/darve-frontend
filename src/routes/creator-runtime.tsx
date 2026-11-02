import { lazy, Suspense } from 'react';
import { loadCreatorBoundary } from '@/features/session-status/index';
import { RootLayout } from './root-layout';
const CreatorBoundary = lazy(loadCreatorBoundary);

export function CreatorRuntime({ origin }: { origin: string | undefined }) {
  return origin ? (
    <Suspense fallback={<p role="status">Checking connection…</p>}>
      <CreatorBoundary origin={origin}>
        <RootLayout />
      </CreatorBoundary>
    </Suspense>
  ) : (
    <RootLayout />
  );
}
