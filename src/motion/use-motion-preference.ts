import { useSyncExternalStore } from 'react';

const query = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const media = window.matchMedia(query);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function getSnapshot() {
  return typeof window === 'undefined' || !window.matchMedia || window.matchMedia(query).matches;
}

/** Missing browser preference support defaults to still, visible content. */
export function useMotionPreference() {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
