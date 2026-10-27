import { useRef, type PropsWithChildren } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { motionTokens } from './tokens';

gsap.registerPlugin(useGSAP);

// Use for a single coordinated entrance, not for realtime business transitions.
export function SequenceReveal({ children, className }: PropsWithChildren<{ className?: string }>) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (!window.matchMedia) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(root.current, {
          y: 12,
          duration: motionTokens.entrance,
          ease: 'power2.out',
          clearProps: 'transform',
        });
      });
      return () => media.revert();
    },
    { scope: root },
  );
  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}
