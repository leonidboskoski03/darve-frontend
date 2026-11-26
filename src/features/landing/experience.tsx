import { useCallback, useEffect, useRef, useState } from 'react';
import './experience.css';

const CHALLENGES = [
  {
    name: 'WIN WITH RANDOMIZED CONTROLS',
    description: 'Win a match with completely randomized key bindings.',
    raised: 240,
    goal: 300,
    pct: 80,
    deadline: '12 MIN LEFT',
  },
  {
    name: 'GET THE RONALDO 2002 HAIRCUT',
    description: "Get Ronaldo Nazário's iconic 2002 World Cup haircut live if funded.",
    raised: 460,
    goal: 800,
    pct: 57.5,
    deadline: '24 MIN LEFT',
  },
  {
    name: 'STREAM IN A DINOSAUR COSTUME',
    description: 'Play the next ranked match in an inflatable dinosaur costume.',
    raised: 90,
    goal: 150,
    pct: 60,
    deadline: '08 MIN LEFT',
  },
] as const;

function overlayScaleForWidth(width: number) {
  if (width <= 560) return 0.42;
  if (width <= 720) return 0.56;
  if (width <= 1024) return 0.66;
  return 0.78;
}

/** Concept 70 Experience — challenge select + illustrative OBS preview. Presentation only. */
export function Experience() {
  const sectionRef = useRef<HTMLElement>(null);
  const [activeChallenge, setActiveChallenge] = useState(0);
  const [bump, setBump] = useState(false);
  const [overlayScale, setOverlayScale] = useState(() =>
    typeof window !== 'undefined' ? overlayScaleForWidth(window.innerWidth) : 0.78,
  );
  const [demoLive, setDemoLive] = useState(
    () =>
      typeof window !== 'undefined' &&
      (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        !('IntersectionObserver' in window)),
  );

  const pickChallenge = useCallback((index: number) => {
    setActiveChallenge(index);
    setBump(false);
    requestAnimationFrame(() => setBump(true));
  }, []);

  useEffect(() => {
    const updateScale = () => setOverlayScale(overlayScaleForWidth(window.innerWidth));
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setDemoLive(entries.some((entry) => entry.isIntersecting));
      },
      { threshold: [0, 0.12, 0.2], rootMargin: '-10% 0px -10% 0px' },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const selected = CHALLENGES[activeChallenge]!;
  const overlayPreviewSrc =
    `/tests/fixtures/showcase.html` +
    `?template=stardust_darve` +
    `&scene=funding` +
    `&controls=0` +
    `&qr=0` +
    `&position=bottom_right` +
    `&scale=${overlayScale}` +
    `&mx=0` +
    `&my=0` +
    `&text=${encodeURIComponent(selected.name)}` +
    `&raised=${selected.raised}` +
    `&goal=${selected.goal}`;

  return (
    <section
      className={`experience${demoLive ? ' is-demo-live' : ''}`}
      id="experience"
      ref={sectionRef}
      aria-labelledby="experience-title"
    >
      <h2 id="experience-title">
        THE NEXT MOMENT
        <br />
        IS <em>UNWRITTEN.</em>
      </h2>

      {CHALLENGES.map((challenge, index) => {
        const active = index === activeChallenge;
        return (
          <div
            key={challenge.name}
            className={`challenge${active ? ' active' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={active}
            aria-label={`Select challenge: ${challenge.name}`}
            onClick={() => pickChallenge(index)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                pickChallenge(index);
              }
            }}
          >
            <span className="num landing-micro">{String(index + 1).padStart(2, '0')}</span>
            <span className="name">{challenge.name}</span>
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onClick={(event) => {
                event.stopPropagation();
                pickChallenge(index);
              }}
            >
              {active ? 'SELECTED ✓' : 'SELECT ↗'}
            </button>
          </div>
        );
      })}

      <div className="dv64-experience-demo dv-reveal">
        <div className="dv64-demo-intro">
          <span className="dv64-demo-tag">OBS OVERLAY / INTERACTIVE PREVIEW</span>
          <span className="landing-micro">ILLUSTRATIVE DEMO VALUES</span>
        </div>
        <div className={`dv64-demo-stage${bump ? ' dv64-bump' : ''}`}>
          <div className="dv64-stream-top">
            <span>
              <i /> LIVE STREAM / DEMO
            </span>
            <span>VIEWER-FUNDED CHALLENGE</span>
          </div>
          <div className="dv64-game-scene">
            <div className="dv64-scene-grid" />
            <span>YOUR STREAM</span>
          </div>
          {demoLive ? (
            <iframe
              key={selected.name}
              className="dv64-overlay-frame"
              title={`Darve Stardust overlay preview: ${selected.name}`}
              src={overlayPreviewSrc}
              loading="lazy"
              referrerPolicy="no-referrer"
              style={{ backgroundColor: 'transparent', colorScheme: 'normal' }}
            />
          ) : (
            <div className="dv64-overlay-frame" aria-hidden="true" />
          )}
        </div>
        <p className="dv64-demo-foot">
          {selected.description} Funding and deadline figures are illustrative only.
        </p>
      </div>
    </section>
  );
}
