import { ArrowRight, Coins, MonitorPlay, Users } from 'lucide-react';
import { ActionLink } from '@/design-system/action-link';
import { Starfield } from '@/design-system/starfield';
import { SequenceReveal } from '@/motion/sequence-reveal';
import { DashboardIllustration } from './dashboard-illustration';
import './landing.css';

export function Landing({ connectHref }: { connectHref: string }) {
  return (
    <div className="landing">
      <Starfield />
      <section className="landing-hero" aria-labelledby="landing-title">
        <SequenceReveal>
          <h1 id="landing-title">
            <span>The Engagement Engine</span>
            <br />
            for Your Viewers<span className="landing-hero__period">.</span>
          </h1>
        </SequenceReveal>
        <p className="landing-hero__description">
          The tool that turns viewer ideas into funded live challenges — without losing control of
          your stream.
        </p>
        <ActionLink href={connectHref} className="landing-hero__connect">
          Connect your stream <ArrowRight size={20} aria-hidden="true" />
        </ActionLink>
        <p className="landing-hero__providers">
          Twitch <span aria-hidden="true">·</span> YouTube <span aria-hidden="true">·</span> Kick
        </p>
        <ul className="landing-hero__features" id="how-it-works">
          <li>
            <Users size={16} aria-hidden="true" />
            Viewers submit challenges
          </li>
          <li>
            <Coins size={16} aria-hidden="true" />
            Viewers fund the goal
          </li>
          <li>
            <MonitorPlay size={16} aria-hidden="true" />
            Auto overlay
          </li>
        </ul>
      </section>
      <DashboardIllustration />
    </div>
  );
}
