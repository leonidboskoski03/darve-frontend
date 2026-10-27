import { lazy, Suspense, useState, type PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MotionProvider } from '@/motion/provider';
import { createQueryClient } from '@/services/server-state/index';
import { environment } from '@/services/config/index';

const CreatorBoundary = lazy(() => import('./creator-boundary'));

export function AppProviders({ children }: PropsWithChildren) {
  const [publicQueries] = useState(createQueryClient);
  return (
    <MotionProvider>
      <div data-environment={environment.appEnv}>
        {environment.apiOrigin ? (
          <Suspense fallback={<p role="status">Checking connection…</p>}>
            <CreatorBoundary origin={environment.apiOrigin}>{children}</CreatorBoundary>
          </Suspense>
        ) : (
          <QueryClientProvider client={publicQueries}>{children}</QueryClientProvider>
        )}
      </div>
    </MotionProvider>
  );
}
