import { LazyMotion, MotionConfig } from 'framer-motion';
import type { PropsWithChildren } from 'react';

const loadFeatures = () => import('./runtime').then((module) => module.default);

export function MotionProvider({ children }: PropsWithChildren) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
