import { AnimatePresence, LazyMotion, domAnimation, m, useIsPresent } from 'framer-motion';
import type { PropsWithChildren } from 'react';
import { motionTokens } from './tokens';
import { useMotionPreference } from './use-motion-preference';

function PresentContent({ children }: PropsWithChildren) {
  const present = useIsPresent();
  return (
    <m.div
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: motionTokens.fast }}
      inert={!present}
      aria-hidden={!present || undefined}
    >
      {children}
    </m.div>
  );
}

/** Display-only inline content. Entries are immediate; exits are inert and hidden from speech. */
export function Presence({ visible, children }: PropsWithChildren<{ visible: boolean }>) {
  const reduce = useMotionPreference();
  if (reduce) return visible ? <div>{children}</div> : null;
  return (
    <LazyMotion features={domAnimation} strict>
      <AnimatePresence initial={false}>
        {visible ? <PresentContent key="content">{children}</PresentContent> : null}
      </AnimatePresence>
    </LazyMotion>
  );
}
