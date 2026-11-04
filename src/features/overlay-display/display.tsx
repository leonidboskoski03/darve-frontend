import { useMemo, useSyncExternalStore } from 'react';
import { consumerMoney } from '@/services/contracts/index';
import { qrMatrix, type OverlayReader } from '@/services/overlay/index';
import { resolveOverlayTemplate } from '@/entities/overlay-template/index';
import './display.css';
import './compact.css';

const phases: Record<string, string> = {
  preparing: 'Preparing collection',
  collecting: 'Viewer ideas are open',
  collection_closed: 'Collection closed',
  analysis_running: 'Reviewing viewer ideas',
  analysis_queued: 'Ideas waiting for review',
  analysis_failed: 'Idea review unavailable',
  choosing: 'Creator is choosing a challenge',
  failed: 'Collection unavailable',
};
function time(seconds: number | null) {
  return seconds === null
    ? null
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function Qr({ payload }: { payload: string }) {
  const qr = useMemo(() => qrMatrix(payload), [payload]);
  return qr ? (
    <aside className="obs-qr">
      <strong>Darve</strong>
      <svg
        role="img"
        aria-label="Scan to view this challenge"
        viewBox={`0 0 ${qr.size} ${qr.size}`}
        shapeRendering="crispEdges"
      >
        <rect width={qr.size} height={qr.size} fill="white" />
        <path d={qr.path} fill="#000" />
      </svg>
      <span>Scan for challenge</span>
    </aside>
  ) : null;
}
export function OverlayDisplay({ reader }: { reader: OverlayReader }) {
  const value = useSyncExternalStore(reader.subscribe, reader.getSnapshot);
  const frame = value.snapshot,
    presentation = value.presentation;
  if (!frame || !presentation?.fresh || !('template' in frame.preferences))
    return <div data-obs-phase={value.phase} />;
  const template = resolveOverlayTemplate(frame.preferences.template);
  if (!template) return <div data-obs-phase="unsupported-template" />;
  const challenge = frame.challenge,
    state = frame.presentationState;
  if (
    state === 'idle' ||
    ['restricted', 'accepted_unavailable'].includes(state) ||
    (challenge && challenge.contentAvailability !== 'available')
  )
    return <div data-obs-phase={state} />;
  const styles = frame.preferences.styles;
  const declared = challenge?.performance.state === 'declared_complete';
  const status = declared
    ? 'Streamer declared complete'
    : challenge?.funding.state === 'funded'
      ? 'Goal reached'
      : challenge?.funding.state === 'unsuccessful'
        ? 'Funding closed'
        : state === 'accepted_closed'
          ? 'Contribution window closed'
          : challenge
            ? 'Darve challenge'
            : (phases[state] ?? 'Collection unavailable');
  const seconds = challenge ? presentation.fundingSeconds : presentation.collectionSeconds;
  const goal = challenge ? BigInt(challenge.terms.goal.amountMinor) : 1n;
  const eligible = challenge ? BigInt(challenge.funding.eligibleGross) : 0n;
  const progress = Number(((eligible < goal ? eligible : goal) * 10000n) / goal) / 100;
  const money = (amount: string) => {
    if (!challenge) return '';
    const currency = challenge.terms.goal.currency;
    const decimal = consumerMoney(amount, currency).decimal;
    return decimal === null ? `${amount} minor units · ${currency}` : `${decimal} ${currency}`;
  };
  const payload =
    !declared &&
    challenge?.funding.state === 'pending' &&
    challenge.contributionUrl === presentation.qrPayload
      ? presentation.qrPayload
      : null;
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
          '--obs-x': `${styles.marginX}px`,
          '--obs-y': `${styles.marginY}px`,
        } as React.CSSProperties
      }
    >
      <article className="obs-card" aria-label="Darve broadcast challenge">
        <div className="obs-main">
          <div className="obs-top">
            <strong className="obs-status">{status}</strong>
            {!declared && seconds !== null && (
              <span
                className="obs-time"
                aria-label={challenge ? 'Contribution time remaining' : 'Collection time remaining'}
              >
                {time(seconds)}
              </span>
            )}
          </div>
          <h1>
            {challenge?.terms.text ?? (state === 'collecting' ? 'What should we do next?' : status)}
          </h1>
          {challenge ? (
            <>
              <div className="obs-bottom">
                <div className="obs-credits">
                  <span>Ideas from</span>
                  <p>
                    {challenge.authors.map((a) => a.displayName ?? 'Anonymous viewer').join(', ') ||
                      'Viewer ideas'}
                  </p>
                </div>
                <div className="obs-funding">
                  <div>
                    <strong>{money(challenge.funding.eligibleGross)}</strong>
                    <span>of {money(challenge.terms.goal.amountMinor)}</span>
                  </div>
                  <div
                    className="obs-progress"
                    role="progressbar"
                    aria-label="Deadline-eligible contributions"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                  >
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <span>Deadline-eligible contributions</span>
                </div>
              </div>
              {(challenge.funding.unclassifiedGross !== '0' ||
                challenge.funding.financialReviewRequired) && (
                <p className="obs-review">
                  Some verified contributions await timing or financial review.
                </p>
              )}
            </>
          ) : (
            <p className="obs-subtitle">
              {state === 'collecting'
                ? 'Submit your ideas in stream chat.'
                : 'The next challenge will appear here when selected.'}
            </p>
          )}
        </div>
        {payload && <Qr key={payload} payload={payload} />}
      </article>
    </div>
  );
}
