import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { roundReviewMessage } from '@/entities/round-review/index';
import { resolveOverlayTemplate } from '@/entities/overlay-template/index';
import type { OverlayReader } from '@/services/overlay/index';
import { OverlayDisplay as ChallengeDisplay } from './display';
import './viewer-link.css';
import { LazyOverlayScene } from '@/motion/lazy-overlay-scene';
import { isImmersiveVariant } from '@/motion/immersive-variants';

export function OverlayDisplay({ reader }: { reader: OverlayReader }) {
  const value = useSyncExternalStore(reader.subscribe, reader.getSnapshot);
  const { snapshot: frame, presentation } = value;
  const display = useRef<HTMLDivElement>(null);
  const [qr, setQr] = useState<Element | null>(null);
  const payload = presentation?.qrPayload;
  const url = payload ? frame?.viewerUrl : undefined;
  useLayoutEffect(() => {
    // Enhance the common QR slot without changing the approved template renderer.
    setQr(url ? (display.current?.querySelector('.obs-qr') ?? null) : null);
  }, [payload, url, frame?.version]);
  if (
    !frame ||
    !presentation?.fresh ||
    frame.challenge ||
    !('template' in frame.preferences) ||
    !('reviewState' in frame) ||
    !frame.reviewState
  ) {
    return (
      <div ref={display} className="obs-challenge-frame">
        <ChallengeDisplay reader={reader} />
        {url &&
          qr &&
          createPortal(
            <span className="obs-viewer-url">{url.replace(/^https?:\/\//, '')}</span>,
            qr,
          )}
      </div>
    );
  }
  if (frame.reviewState === 'restricted') return <div data-obs-phase="restricted" />;
  const template = resolveOverlayTemplate(frame.preferences.template);
  if (!template) return <div data-obs-phase="unsupported-template" />;

  const state =
    frame.reviewState === 'collecting' && presentation.collectionSeconds === 0
      ? 'closing'
      : frame.reviewState;
  const status = roundReviewMessage[state];
  const seconds = state === 'collecting' ? presentation.collectionSeconds : null;
  const { styles } = frame.preferences;
  return (
    <div
      className="obs-stage"
      data-obs-phase={state}
      data-template={template.variant}
      data-position={styles.position}
      style={
        {
          '--obs-scale': styles.scale,
          '--obs-opacity': styles.opacity,
          '--obs-x': styles.marginX + 'px',
          '--obs-y': styles.marginY + 'px',
        } as React.CSSProperties
      }
    >
      <article className="obs-card" aria-label="Darve broadcast challenge">
        {isImmersiveVariant(template.variant) && (
          <LazyOverlayScene
            variant={template.variant}
            progress={0}
            funded={false}
            complete={false}
            pulseKey="collection"
          />
        )}
        <div className="obs-main">
          <div className="obs-top">
            <strong className="obs-status">{status}</strong>
            {seconds !== null && (
              <span className="obs-time" aria-label="Collection time remaining">
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
              </span>
            )}
          </div>
          <h1>{state === 'collecting' ? 'What should we do next?' : status}</h1>
        </div>
      </article>
    </div>
  );
}
