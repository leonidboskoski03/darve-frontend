import { useRef, type PropsWithChildren } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

/** Staggered hero entrance for the public landing. Presentation only — no business side effects. */
export function LandingHeroReveal({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (!window.matchMedia) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const stages = root.current?.querySelectorAll<HTMLElement>('[data-landing-stage]');
        if (!stages?.length) return;
        gsap.set(stages, { opacity: 0, y: 36 });
        gsap.to(stages, {
          opacity: 1,
          y: 0,
          duration: 0.95,
          ease: 'power3.out',
          stagger: 0.11,
          delay: 0.08,
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
