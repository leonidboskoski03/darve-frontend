import { createContext, useContext, useSyncExternalStore } from 'react';
import type { CreatorSession } from '@/services/creator-session/index';

export const CreatorSessionContext = createContext<CreatorSession | null>(null);

export function useCreatorSession() {
  const controller = useContext(CreatorSessionContext);
  if (!controller) throw new Error('Creator session boundary is missing.');
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return { controller, snapshot };
}
