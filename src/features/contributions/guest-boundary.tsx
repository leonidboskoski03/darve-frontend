import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  createContributionController,
  type ContributionRuntime,
} from '@/services/contributions/index';

export function GuestBoundary({
  origin,
  children,
}: {
  origin: string;
  children: (runtime: ContributionRuntime) => ReactNode;
}) {
  const [controller] = useState(() => createContributionController(origin));
  const runtime = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  return runtime ? (
    <QueryClientProvider key={runtime.scope.id} client={runtime.scope.queryClient}>
      {children(runtime)}
    </QueryClientProvider>
  ) : (
    <p role="status">Opening contribution page…</p>
  );
}
