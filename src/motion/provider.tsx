import { MotionConfig } from 'framer-motion';
import type { PropsWithChildren } from 'react';
import { useMotionPreference } from './use-motion-preference';

export function MotionProvider({ children }: PropsWithChildren) {
  const reduce = useMotionPreference();
  return <MotionConfig reducedMotion={reduce ? 'always' : 'never'}>{children}</MotionConfig>;
}
