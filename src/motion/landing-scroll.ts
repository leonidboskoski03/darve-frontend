import { useEffect, type RefObject } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

gsap.registerPlugin(ScrollTrigger);

/** Dispatched on every Lenis scroll so How It Works stays synced to the same scroll root. */
export const LANDING_SCROLL_EVENT = 'darve:landing-scroll';

/**
 * Concept 70 scroll stack for the public landing:
 * Lenis (duration 1.15) + GSAP ticker bridge + ScrollTrigger reveals.
 * Presentation only — no business side effects on animation completion.
 */
export function useLandingScroll(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    window.scrollTo(0, 0);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      root
        .querySelectorAll(
          '.dv-reveal, .hero-stage, .dv63-heading h2, .faq-heading h2, .contact-main h2',
        )
        .forEach((node) => {
          const el = node as HTMLElement;
          el.style.opacity = '1';
          el.style.transform = 'none';
        });
      return;
    }

    root.classList.add('dv-motion');
    document.documentElement.classList.add('lenis', 'lenis-smooth');

    const lenis = new Lenis({
      // Exact Concept 70 inertia — gsap.ticker is the only RAF driver (autoRaf stays false).
      autoRaf: false,
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.35,
      syncTouch: false,
    });

    lenis.scrollTo(0, { immediate: true });

    // Coalesce scroll fan-out to one frame — keeps HIW/timeline cheap under Lenis.
    let scrollNotifyFrame = 0;
    const notifyScroll = () => {
      if (scrollNotifyFrame) return;
      scrollNotifyFrame = requestAnimationFrame(() => {
        scrollNotifyFrame = 0;
        window.dispatchEvent(new Event(LANDING_SCROLL_EVENT));
        ScrollTrigger.update();
      });
    };
    lenis.on('scroll', notifyScroll);

    const ticker = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(ticker);
    // Mild catch-up after frame drops (0 forced every frame and amplified hitchiness).
    gsap.ticker.lagSmoothing(500, 33);

    const ctx = gsap.context(() => {
      const stages = root.querySelectorAll<HTMLElement>('.hero-stage');
      if (stages.length) {
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
      }

      const reveals = gsap.utils.toArray<HTMLElement>(root.querySelectorAll('.dv-reveal'));
      reveals.forEach((el, i) => {
        const fromY = el.matches('.landing-rail, .dv63-heading, h2') ? 56 : 40;
        gsap.fromTo(
          el,
          { opacity: 0, y: fromY },
          {
            opacity: 1,
            y: 0,
            duration: 0.95,
            ease: 'power3.out',
            clearProps: 'transform',
            scrollTrigger: {
              trigger: el,
              start: 'top 88%',
              end: 'top 55%',
              toggleActions: 'play none none none',
              once: true,
            },
            delay: Math.min(0.18, (i % 3) * 0.04),
          },
        );
      });

      const frame = root.querySelector('.darve-showcase-frame');
      const hero = root.querySelector('.landing-hero');
      if (frame && hero) {
        gsap.fromTo(
          frame,
          { y: 28 },
          {
            y: -18,
            ease: 'none',
            scrollTrigger: {
              trigger: hero,
              start: 'top top',
              end: 'bottom top',
              scrub: true,
            },
          },
        );
      }

      const bigTitles = gsap.utils.toArray<HTMLElement>(
        root.querySelectorAll(
          '.dv63-heading h2, .experience > h2, .dv62-voices-head h2, .faq-heading h2, .contact-main h2',
        ),
      );
      bigTitles.forEach((title) => {
        gsap.fromTo(
          title,
          { opacity: 0, y: 72 },
          {
            opacity: 1,
            y: 0,
            duration: 1.05,
            ease: 'power3.out',
            clearProps: 'transform',
            scrollTrigger: {
              trigger: title,
              start: 'top 92%',
              once: true,
            },
          },
        );
      });

      const challenges = gsap.utils.toArray<HTMLElement>(
        root.querySelectorAll('.experience .challenge'),
      );
      if (challenges.length) {
        gsap.fromTo(
          challenges,
          { opacity: 0, y: 28 },
          {
            opacity: 1,
            y: 0,
            duration: 0.75,
            ease: 'power3.out',
            stagger: 0.09,
            clearProps: 'transform',
            scrollTrigger: {
              trigger: root.querySelector('.experience'),
              start: 'top 75%',
              once: true,
            },
          },
        );
      }
    }, root);

    const onNavClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a[href^="#"]');
      if (!(link instanceof HTMLAnchorElement)) return;
      const id = link.getAttribute('href');
      if (!id || id === '#') return;
      const section = root.querySelector(id);
      if (!(section instanceof HTMLElement)) return;
      event.preventDefault();
      lenis.scrollTo(section, { offset: 0 });
    };
    root.addEventListener('click', onNavClick);

    return () => {
      root.removeEventListener('click', onNavClick);
      cancelAnimationFrame(scrollNotifyFrame);
      ctx.revert();
      gsap.ticker.remove(ticker);
      lenis.destroy();
      root.classList.remove('dv-motion');
      document.documentElement.classList.remove('lenis', 'lenis-smooth');
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
    };
  }, [rootRef]);
}
