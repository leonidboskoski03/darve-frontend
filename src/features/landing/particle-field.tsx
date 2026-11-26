import { useEffect, useRef } from 'react';

type Particle = {
  x: number;
  y: number;
  z: number;
  color: string;
};

const COLORS = [
  '#A00070',
  '#A00070',
  '#A00070',
  '#C02A91',
  '#C02A91',
  '#85005E',
  '#FFFFFF',
  '#D4D4D8',
];

/** Vanishing point within the upper hero (above the video). */
const ORIGIN_X = 0.7;
const ORIGIN_Y = 0.4;

function particleCountForWidth(width: number) {
  // Slightly lighter than Concept density — same look, less canvas work.
  if (width <= 480) return 90;
  if (width <= 900) return 160;
  return 260;
}

/** Animated particle field for the landing hero. Presentation only; pauses off-screen and respects reduced motion. */
export function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let upperH = 0;
    let particles: Particle[] = [];
    let frame = 0;
    let last = 0;
    let visible = true;
    let pageVisible = document.visibilityState !== 'hidden';
    let running = false;

    const makeParticle = (initial = false): Particle => ({
      x: (Math.random() - 0.5) * w,
      y: (Math.random() - 0.5) * upperH,
      z: (initial ? Math.random() : 1) * Math.max(w, 1),
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
    });

    const measureUpperHero = () => {
      const hero = canvas.closest('.landing-hero');
      const showcase = hero?.querySelector('.darve-showcase-frame');
      if (!hero || !showcase) {
        upperH = h;
        return;
      }
      const heroRect = hero.getBoundingClientRect();
      const showRect = showcase.getBoundingClientRect();
      upperH = Math.max(1, showRect.top - heroRect.top);
    };

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      measureUpperHero();
      particles = Array.from({ length: particleCountForWidth(w) }, () => makeParticle(true));
      ctx.fillStyle = '#0F0F11';
      ctx.fillRect(0, 0, w, h);
    };

    const render = (t: number) => {
      if (!running) return;
      const delta = last ? Math.min((t - last) / 16.667, 2) : 1;
      last = t;
      ctx.fillStyle = '#0F0F11';
      ctx.fillRect(0, 0, w, h);

      const cx = w * ORIGIN_X;
      const cy = upperH * ORIGIN_Y;
      const fov = 350;
      const depth = Math.max(w, 1);
      const clipBottom = upperH;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, clipBottom);
      ctx.clip();

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]!;
        if (!reduced) p.z -= 3.0 * delta;
        if (p.z <= 0) {
          particles[i] = makeParticle();
          continue;
        }
        const scale = fov / Math.max(p.z, 0.1);
        const x = p.x * scale + cx;
        const y = p.y * scale + cy;
        if (x < 0 || x > w || y < 0 || y > clipBottom) continue;
        const depthFade = 1 - p.z / depth;
        if (depthFade < 0.12) continue;
        const radius = Math.min(1.85, Math.max(0.35, 1.35 * scale));
        ctx.globalAlpha = Math.min(0.9, depthFade * depthFade * 1.05);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      if (!reduced && running) frame = requestAnimationFrame(render);
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
      last = 0;
    };

    const start = () => {
      if (running || reduced) {
        if (reduced && !running) {
          running = true;
          resize();
          render(performance.now());
          running = false;
        }
        return;
      }
      if (!visible || !pageVisible) return;
      running = true;
      last = 0;
      frame = requestAnimationFrame(render);
    };

    const sync = () => {
      if (visible && pageVisible && !reduced) start();
      else stop();
    };

    const onResize = () => {
      stop();
      resize();
      sync();
    };

    resize();
    sync();
    const rem = requestAnimationFrame(() => {
      measureUpperHero();
    });

    const io =
      'IntersectionObserver' in window
        ? new IntersectionObserver(
            (entries) => {
              visible = entries.some((e) => e.isIntersecting);
              sync();
            },
            { root: null, threshold: 0.01 },
          )
        : null;
    io?.observe(canvas);

    const onVisibility = () => {
      pageVisible = document.visibilityState !== 'hidden';
      sync();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);

    return () => {
      stop();
      cancelAnimationFrame(rem);
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div aria-hidden="true" className="landing-particles">
      <canvas ref={canvasRef} />
    </div>
  );
}
