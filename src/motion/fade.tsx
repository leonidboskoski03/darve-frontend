import { m, useReducedMotion } from 'framer-motion';
import type { PropsWithChildren } from 'react';
import { motionTokens } from './tokens';

export function Fade({ children }: PropsWithChildren) {
  const reduce = useReducedMotion();
  return (
    <m.div
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : motionTokens.standard }}
    >
      {children}
    </m.div>
  );
}
