import { useLayoutEffect, type RefObject } from 'react';
import { animate } from 'framer-motion/dom/mini';
import { motionTokens } from './tokens';
import { useMotionPreference } from './use-motion-preference';

/** Animate the current surface in place so navigation never retains the previous screen. */
export function useRouteEntrance(surface: RefObject<HTMLElement | null>, pathname: string) {
  const reduce = useMotionPreference();

  useLayoutEffect(() => {
    const element = surface.current;
    if (reduce || !element?.animate) return;

    const entrance = animate(
      element,
      { opacity: [0.9, 1] },
      { duration: motionTokens.standard, ease: [0.22, 1, 0.36, 1] },
    );
    return () => entrance.cancel();
  }, [surface, pathname, reduce]);
}
