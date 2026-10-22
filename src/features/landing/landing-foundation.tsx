import { ArrowUpRight } from 'lucide-react';
import { Fade } from '@/motion/fade';
import { SequenceReveal } from '@/motion/sequence-reveal';

export function LandingFoundation() {
  return (
    <section className="foundation" aria-labelledby="landing-title">
      <p className="eyebrow">THE FRONTEND REBUILD · FOUNDATION 00</p>
      <SequenceReveal>
        <h1 id="landing-title">
          <span>The Engagement Engine</span> for Your Viewers.
        </h1>
      </SequenceReveal>
      <p className="intro">
        The tool that turns viewer ideas into funded live challenges — without losing control of
        your stream.
      </p>
      <Fade>
        <div className="foundation-status">
          <h2>
            <ArrowUpRight size={16} aria-hidden="true" />
            Frontend foundation
          </h2>
          <p>
            This local preview establishes the application structure. Streamer login, contributions
            and OBS integration are not connected yet.
          </p>
        </div>
      </Fade>
    </section>
  );
}
