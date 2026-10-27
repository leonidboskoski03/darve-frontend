import { useEffect, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createCreatorSession } from '@/services/creator-session/index';
import { CreatorSessionContext } from '@/features/session-status/index';

export default function CreatorBoundary({
  origin,
  children,
}: PropsWithChildren<{ origin: string }>) {
  const [session] = useState(() => createCreatorSession({ origin }));
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  useEffect(() => {
    session.start();
    return () => session.stop();
  }, [session]);
  return (
    <CreatorSessionContext.Provider value={session}>
      <QueryClientProvider key={snapshot.scope.id} client={snapshot.scope.queryClient}>
        {children}
      </QueryClientProvider>
    </CreatorSessionContext.Provider>
  );
}
