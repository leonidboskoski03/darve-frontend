import { useCallback, useEffect, useRef, useState } from 'react';
import { Brand } from '@/design-system/brand';
import { useLandingScroll } from '@/motion/landing-scroll';
import { ConnectMenu } from './connect-menu';
import { Experience } from './experience';
import { HowItWorks } from './how-it-works';
import { ParticleField } from './particle-field';
import { FaqContact } from './faq-contact';
import { StreamersSay } from './streamers-say';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import '@fontsource/syne/700.css';
import '@fontsource/syne/800.css';
import './landing.css';

export function Landing({ connectHref }: { connectHref: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  useLandingScroll(rootRef);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tryPlay = () => {
      if (reduced) {
        video.pause();
        return;
      }
      void video.play().catch(() => undefined);
    };

    // Autoplay starts muted; sound only changes on explicit click.
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 1;

    const detectAudio = () => {
      const media = video as HTMLVideoElement & {
        audioTracks?: { length: number };
        mozHasAudio?: boolean;
        webkitAudioDecodedByteCount?: number;
      };
      let detected = false;
      if (media.audioTracks) detected = media.audioTracks.length > 0;
      else if (typeof media.mozHasAudio === 'boolean') detected = media.mozHasAudio;
      else if (typeof media.webkitAudioDecodedByteCount === 'number')
        detected = media.webkitAudioDecodedByteCount > 0;
      setHasAudio((prev) => (prev === detected ? prev : detected));
      if (detected) video.removeEventListener('timeupdate', detectAudio);
    };

    tryPlay();
    video.addEventListener('loadeddata', tryPlay);
    video.addEventListener('canplay', tryPlay);
    video.addEventListener('loadedmetadata', detectAudio);
    // Chromium often only exposes decoded audio after playback progresses.
    video.addEventListener('timeupdate', detectAudio);

    let observer: IntersectionObserver | null = null;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(
        (entries) => {
          const onScreen = entries.some((entry) => entry.isIntersecting);
          if (onScreen) tryPlay();
          else video.pause();
        },
        { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
      );
      observer.observe(video);
    }

    return () => {
      observer?.disconnect();
      video.removeEventListener('loadeddata', tryPlay);
      video.removeEventListener('canplay', tryPlay);
      video.removeEventListener('loadedmetadata', detectAudio);
      video.removeEventListener('timeupdate', detectAudio);
    };
  }, []);

  const toggleShowcaseSound = useCallback(() => {
    const video = videoRef.current;
    if (!video || !hasAudio) return;
    const next = !soundOn;
    video.muted = !next;
    video.volume = 1;
    setSoundOn(next);
    void video.play().catch(() => undefined);
  }, [hasAudio, soundOn]);

  return (
    <div className="landing" ref={rootRef}>
      <div className="landing-shell">
        <header className="landing-nav">
          <a className="landing-nav__brand" href="/" aria-label="Darve home">
            <Brand wordmark />
          </a>
          <nav className="landing-nav__links" aria-label="Primary">
            <div className="landing-nav__center">
              <a href="#how-it-works">THE EXPERIENCE</a>
              <a href="#experience">IN ACTION</a>
              <a href="#faq">FAQ</a>
              <a href="#contact">CONTACT</a>
            </div>
            <ConnectMenu connectHref={connectHref} />
          </nav>
        </header>

        <section className="landing-hero" aria-labelledby="landing-title">
          <ParticleField />
          <div className="landing-hero__content">
            <div className="landing-hero__top hero-stage">
              <span className="landing-hero__eyebrow">A NEW KIND OF LIVE ENTERTAINMENT</span>
            </div>
            <h1 id="landing-title" className="hero-stage">
              <span className="landing-hero__line">MAKE YOUR</span>
              <span className="landing-hero__line landing-hero__line--outline">
                STRE<span className="landing-hero__kern-ea">A</span>M
              </span>
              <span className="landing-hero__line landing-hero__line--legendary">LEGENDARY.</span>
            </h1>
            <p className="landing-hero__description hero-stage">
              The engagement engine for
              <br />
              more revenue, views, and moments.
            </p>
            <div className="darve-showcase-frame hero-stage">
              <div className="darve-showcase-inner">
                <div
                  className={`darve-showcase-sound${soundOn ? ' is-on' : ''}${hasAudio ? ' has-audio' : ''}`}
                >
                  <video
                    ref={videoRef}
                    autoPlay
                    muted={!soundOn}
                    loop
                    playsInline
                    preload="auto"
                    src="/videos/darve-showcase.mp4"
                    aria-label="Darve product showcase"
                  />
                  {hasAudio ? (
                    <button
                      type="button"
                      className="darve-showcase-sound__hit"
                      onClick={toggleShowcaseSound}
                      aria-pressed={soundOn}
                      aria-label={soundOn ? 'Mute showcase video' : 'Unmute showcase video'}
                    >
                      <span className="darve-showcase-sound__hint">
                        {soundOn ? 'SOUND ON · CLICK TO MUTE' : 'CLICK FOR SOUND'}
                      </span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="landing-rail dv-reveal">
          <strong>
            <span className="landing-rail__dot" aria-hidden="true" />
            THE AUDIENCE IS NOW PART OF THE SHOW
          </strong>
          <span className="landing-micro">CHOOSE WHAT HAPPENS NEXT ↘</span>
        </div>

        <HowItWorks />
        <Experience />
        <StreamersSay />
        <FaqContact />
      </div>
    </div>
  );
}
