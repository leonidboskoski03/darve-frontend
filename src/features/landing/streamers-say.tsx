import { useCallback, useEffect, useRef } from 'react';
import './streamers-say.css';

/** Concept 70 “What streamers say” — illustrative carousel only. */
export function StreamersSay() {
  const trackRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  const dragStartX = useRef(0);
  const dragging = useRef(false);

  const maxIndex = useCallback(() => {
    const track = trackRef.current;
    const win = windowRef.current;
    if (!track || !win || !track.firstElementChild) return 0;
    const step = track.firstElementChild.getBoundingClientRect().width + 18;
    return Math.max(0, Math.ceil((track.scrollWidth - win.clientWidth) / step));
  }, []);

  const moveTrack = useCallback(() => {
    const track = trackRef.current;
    const win = windowRef.current;
    if (!track || !win || !track.firstElementChild) return;
    const step = track.firstElementChild.getBoundingClientRect().width + 18;
    const max = Math.max(0, track.scrollWidth - win.clientWidth);
    const capped = Math.max(0, Math.ceil(max / step));
    if (indexRef.current > capped) indexRef.current = capped;
    track.style.transform = 'translateX(-' + Math.min(max, indexRef.current * step) + 'px)';
  }, []);

  useEffect(() => {
    moveTrack();
    const onResize = () => moveTrack();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [moveTrack]);

  return (
    <section className="dv62-voices" id="streamers" aria-labelledby="streamers-title">
      <div className="dv62-voices-head">
        <h2 id="streamers-title">
          WHAT STREAMERS
          <br />
          <em>SAY.</em>
        </h2>
        <div className="dv62-voice-controls">
          <button
            type="button"
            aria-label="Previous creator reaction"
            onClick={() => {
              const max = maxIndex();
              indexRef.current = indexRef.current <= 0 ? max : indexRef.current - 1;
              moveTrack();
            }}
          >
            ←
          </button>
          <button
            type="button"
            aria-label="Next creator reaction"
            onClick={() => {
              const max = maxIndex();
              indexRef.current = indexRef.current >= max ? 0 : indexRef.current + 1;
              moveTrack();
            }}
          >
            →
          </button>
        </div>
      </div>

      <div
        className="dv62-voice-window dv-reveal"
        ref={windowRef}
        onPointerDown={(event) => {
          dragging.current = true;
          dragStartX.current = event.clientX;
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return;
          dragging.current = false;
          const delta = event.clientX - dragStartX.current;
          if (Math.abs(delta) > 35) {
            const max = maxIndex();
            indexRef.current = Math.max(0, Math.min(max, indexRef.current + (delta < 0 ? 1 : -1)));
            moveTrack();
          }
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <div className="dv62-voice-track" ref={trackRef}>
          <article className="dv62-voice-card dv62-voice-photo">
            <div className="dv62-avatar-art">
              <span>01</span>
              <strong>
                LIVE
                <br />
                ON AIR.
              </strong>
              <span className="dv62-avatar-badge">● STREAMING</span>
            </div>
            <div className="dv62-voice-person">
              <small>NOVA REYES · VARIETY STREAMER</small>
            </div>
          </article>

          <article className="dv62-voice-card dv62-voice-quote">
            <span className="dv62-quote-mark">“</span>
            <p>
              My chat doesn&apos;t just react anymore. They actually get to decide what happens
              next.
            </p>
            <div className="dv62-voice-person">
              <small>MILO VEX · GAMING CREATOR</small>
            </div>
          </article>

          <article className="dv62-voice-card dv62-voice-dark">
            <p>
              LESS SCROLLING.
              <br />
              MORE <em>CHAOS.</em>
            </p>
            <div className="dv62-voice-person">
              <small>JAX MORROW · LIVE CREATOR</small>
            </div>
          </article>

          <article className="dv62-voice-card dv62-voice-quote">
            <span className="dv62-quote-mark">“</span>
            <p>It&apos;s the kind of audience interaction I&apos;ve always wanted in my streams.</p>
            <div className="dv62-voice-person">
              <small>ARIA VALE · VARIETY STREAMER</small>
            </div>
          </article>

          <article className="dv62-voice-card dv62-voice-photo dv62-voice-photo-alt">
            <div className="dv62-avatar-art">
              <span>02</span>
              <strong>
                THE
                <br />
                MOMENT.
              </strong>
              <span className="dv62-avatar-badge">● CLIP SAVED</span>
            </div>
            <div className="dv62-voice-person">
              <small>KAI MERCER · GAMING CREATOR</small>
            </div>
          </article>

          <article className="dv62-voice-card dv62-voice-quote">
            <span className="dv62-quote-mark">“</span>
            <p>The best part? The challenge isn&apos;t mine. The whole community made it happen.</p>
            <div className="dv62-voice-person">
              <small>LENA CROSS · LIVE CREATOR</small>
            </div>
          </article>
        </div>
      </div>

      <div className="dv62-voices-bottom">
        <p className="dv62-disclaimer">Illustrative creator reactions — not actual testimonials.</p>
      </div>
    </section>
  );
}
