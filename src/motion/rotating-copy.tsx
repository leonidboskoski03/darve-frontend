import { useEffect, useState } from 'react';
import { AnimatePresence, LazyMotion, domAnimation, m } from 'framer-motion';
import { useMotionPreference } from './use-motion-preference';
import { motionTokens } from './tokens';

const phrases = ['More Revenue', 'Your Viewers', 'Live Streaming'];

export function RotatingCopy() {
  const reduce = useMotionPreference();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % phrases.length),
      4000,
    );
    return () => window.clearInterval(timer);
  }, [reduce]);

  if (reduce) return <span>{phrases[0]}</span>;

  return (
    <LazyMotion features={domAnimation} strict>
      <span className="landing-rotating-copy">
        <span className="landing-rotating-copy__accessible">More Revenue</span>
        <span className="landing-rotating-copy__measure" aria-hidden="true">
          Live Streaming
        </span>
        <AnimatePresence initial={false}>
          <m.span
            key={index}
            className="landing-rotating-copy__word"
            aria-hidden="true"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: motionTokens.standard }}
          >
            {phrases[index]}
          </m.span>
        </AnimatePresence>
      </span>
    </LazyMotion>
  );
}
