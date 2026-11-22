import { Button } from '@/design-system/button';
import type { UncertainIdea } from '@/services/suggestions/index';

export function NeedsYourCall({
  items,
  busy,
  canSelect,
  onDecision,
  onUse,
  onView,
}: {
  items: UncertainIdea[];
  busy: boolean;
  canSelect: boolean;
  onDecision: (item: UncertainIdea, decision: 'allow' | 'skip') => void;
  onUse: (item: UncertainIdea) => void;
  onView?: (item: UncertainIdea) => void;
}) {
  if (!items.length) return null;
  return (
    <section className="review-panel" aria-labelledby="needs-your-call-heading">
      <h2 id="needs-your-call-heading">Needs your call — only you can see this</h2>
      <p className="review-muted">
        The AI was unsure. Allowing an idea keeps it private until you use it as a challenge.
        Decisions are final for this round.
      </p>
      {items.map((item) => (
        <article className="review-row" key={item.id}>
          <div>
            <h3 className="review-uncertain-text">{item.text}</h3>
            <p className="review-muted">
              {item.supporterCount} {item.supporterCount === 1 ? 'supporter' : 'supporters'} ·{' '}
              {item.reasonLabel}
            </p>
            {item.state !== 'pending' && (
              <p role="status">{item.state === 'allowed' ? 'Allowed by you' : 'Skipped'}</p>
            )}
          </div>
          <div className="review-actions">
            {item.state === 'pending' ? (
              <>
                <Button disabled={busy} onClick={() => onDecision(item, 'allow')}>
                  Allow
                </Button>
                <Button tone="secondary" disabled={busy} onClick={() => onDecision(item, 'skip')}>
                  Skip
                </Button>
              </>
            ) : item.state === 'allowed' && !item.selectedChallengeId ? (
              <Button disabled={busy || !canSelect} onClick={() => onUse(item)}>
                Use this challenge
              </Button>
            ) : item.selectedChallengeId && onView ? (
              <Button tone="secondary" onClick={() => onView(item)}>
                View accepted challenge
              </Button>
            ) : null}
          </div>
        </article>
      ))}
    </section>
  );
}
