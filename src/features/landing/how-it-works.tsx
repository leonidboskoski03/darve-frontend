import { useEffect, useRef } from 'react';
import { LANDING_SCROLL_EVENT } from '@/motion/landing-scroll';
import './how-it-works.css';

const HIW_STEPS = [
  {
    marker: 'STEP 01',
    tag: 'COLLECT',
    title: 'START A COLLECTION.',
    body: 'The streamer starts a 30-second challenge collection from the DARVE dashboard. Viewers submit ideas using #darve in connected live chat.',
  },
  {
    marker: 'STEP 02',
    tag: 'FILTER',
    title: 'DARVE FILTERING.',
    body: 'DARVE AI reviews submissions for safety, creativity, engagement, and funding potential, then creates a shortlist.',
  },
  {
    marker: 'STEP 03',
    tag: 'CHOOSE',
    title: 'PICK YOUR CHALLENGE.',
    body: 'The streamer chooses a challenge and sets its funding goal and deadline.',
  },
  {
    marker: 'STEP 04',
    tag: 'FUND',
    title: 'FUNDING.',
    body: 'Viewers contribute through a link or QR code. The OBS overlay displays the challenge, funding progress, and remaining time.',
  },
  {
    marker: 'STEP 05',
    tag: 'DELIVER',
    title: 'MAKE IT HAPPEN.',
    body: 'If the challenge reaches its goal before the deadline, the streamer performs it live.',
  },
] as const;

/** Concept 70 How It Works — zigzag timeline with scroll-synced center rail. Presentation only. */
export function HowItWorks() {
  const sectionRef = useRef<HTMLElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const fill = fillRef.current;
    if (!section || !fill) return;

    let frame = 0;
    const updateTimeline = () => {
      const timeline = section.querySelector('.dv63-timeline');
      const track = timeline?.querySelector('.dv63-track');
      const items = [...section.querySelectorAll<HTMLElement>('.dv63-item')];
      if (!timeline || !track || !items.length) return;

      const rail = track.getBoundingClientRect();
      const focus = window.innerHeight * 0.52;
      const centers = items.map((item) => {
        const dot = item.querySelector('.dv63-dot');
        if (!dot) return 0;
        const rect = dot.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
      const first = centers[0]!;
      const last = centers[centers.length - 1]!;
      const tip = Math.max(first, Math.min(last, focus));
      const height = Math.max(0, Math.min(rail.height, tip - rail.top));
      fill.style.height = (focus < first ? 0 : height) + 'px';

      let current = -1;
      centers.forEach((center, index) => {
        if (center <= focus + 0.5) current = index;
      });
      items.forEach((item, index) => {
        const passed = index <= current;
        item.classList.toggle('is-past', passed && index !== current);
        item.classList.toggle('is-active', index === current);
        item.classList.toggle('dv64-revealed', passed);
        item.classList.toggle('dv64-dot-lit', passed);
      });
    };

    const scheduleTimeline = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateTimeline();
      });
    };

    updateTimeline();
    const settle = window.setTimeout(updateTimeline, 50);
    window.addEventListener(LANDING_SCROLL_EVENT, scheduleTimeline);
    window.addEventListener('scroll', scheduleTimeline, { passive: true });
    window.addEventListener('resize', scheduleTimeline);
    return () => {
      window.clearTimeout(settle);
      cancelAnimationFrame(frame);
      window.removeEventListener(LANDING_SCROLL_EVENT, scheduleTimeline);
      window.removeEventListener('scroll', scheduleTimeline);
      window.removeEventListener('resize', scheduleTimeline);
    };
  }, []);

  return (
    <section className="dv63-how" id="how-it-works" ref={sectionRef} aria-labelledby="hiw-title">
      <div className="dv63-top dv-reveal">
        <span className="landing-micro">A CHALLENGE, FROM START TO FINISH</span>
      </div>
      <div className="dv63-heading">
        <h2 id="hiw-title">
          HOW IT
          <br />
          <em>WORKS.</em>
        </h2>
      </div>
      <div className="dv63-timeline">
        <div className="dv63-track" aria-hidden="true">
          <div className="dv63-track-fill" ref={fillRef} id="dv63-fill" />
        </div>
        {HIW_STEPS.map((step, index) => (
          <article
            key={step.marker}
            className={`dv63-item${index % 2 === 1 ? ' dv63-item--flip' : ''}`}
            data-phase={index}
          >
            <span className="dv63-dot" aria-hidden="true" />
            <div className="dv63-side">
              <div className="dv63-marker">
                {step.marker} <span>/ {step.tag}</span>
              </div>
              <div className="dv63-copy">
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="dv63-end dv-reveal">
        <span className="landing-micro">THAT&apos;S DARVE.</span>
        <strong>YOUR CHAT. YOUR CHALLENGES. YOUR MOMENTS.</strong>
      </div>
    </section>
  );
}
