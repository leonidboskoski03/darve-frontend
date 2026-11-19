import { useSyncExternalStore } from 'react';
import { roundReviewMessage } from '@/entities/round-review/index';
import { resolveOverlayTemplate } from '@/entities/overlay-template/index';
import type { OverlayReader } from '@/services/overlay/index';
import { OverlayDisplay as ChallengeDisplay } from './display';

export function OverlayDisplay({ reader }: { reader: OverlayReader }) {
  const value = useSyncExternalStore(reader.subscribe, reader.getSnapshot);
  const { snapshot: frame, presentation } = value;
  if (
    !frame ||
    !presentation?.fresh ||
    frame.challenge ||
    !('template' in frame.preferences) ||
    !('reviewState' in frame) ||
    !frame.reviewState
  ) {
    return <ChallengeDisplay reader={reader} />;
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
