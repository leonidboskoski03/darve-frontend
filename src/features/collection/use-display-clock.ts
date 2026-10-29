import { useEffect, useState, useSyncExternalStore } from 'react';
import { isCollectionVisible, subscribeCollectionVisibility } from '@/services/collection/index';
export function useDisplayClock(ticking = true) {
  const visible = useSyncExternalStore(
    subscribeCollectionVisibility,
    isCollectionVisible,
    () => true,
  );
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!visible || !ticking) return;
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, [visible, ticking]);
  return { now, visible };
}
