import { Button } from '@/design-system/button';
import { contributionMoney, type PublicChallengeDto } from '@/services/contributions/index';
const reasons = {
  account_restricted: 'Contributions are unavailable for this creator.',
  source_unavailable: 'The challenge source is unavailable.',
  deadline_passed: 'The funding window has closed.',
  payments_unconfigured: 'Payments are not enabled for this challenge.',
  receiving_unavailable: 'This method cannot currently receive the contribution.',
  goal_reached: 'The funding goal has been recognized. New contributions are closed.',
  reconciliation_required:
    'We’re confirming payments that may complete the goal. Please check back shortly.',
};
const money = contributionMoney;
const time = (value: string) =>
  new Intl.DateTimeFormat('en', {
    timeZone: 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
export function ChallengeDetails({
  value,
  serverTime,
  fee,
  refreshing,
  refresh,
}: {
  value: PublicChallengeDto;
  serverTime: string;
  fee: string | null;
  refreshing: boolean;
  refresh: () => void;
}) {
  return (
    <details className="contribution-disclosure">
      <summary>{fee && <>{fee} · </>}Details</summary>
      <Button tone="secondary" aria-busy={refreshing} onClick={refresh}>
        Refresh challenge
      </Button>
      <p className="contribution-muted">
        Snapshot as of {time(serverTime)} UTC. Refresh for current status.
      </p>
      <dl className="contribution-details">
        <div>
          <dt>Funding closes</dt>
          <dd>{time(value.fundingWindow?.effectiveClosesAt ?? value.terms.fundingClosesAt)} UTC</dd>
        </div>
        <div>
          <dt>Funding status</dt>
          <dd>
            {value.funding.state === 'funded'
              ? 'Goal reached ✓'
              : value.funding.state === 'unsuccessful'
                ? 'Funding unsuccessful'
                : 'Awaiting funding'}
          </dd>
        </div>
        <div>
          <dt>Performance</dt>
          <dd>
            {value.performance.state === 'declared_complete'
              ? 'Streamer declared complete'
              : value.performance.state === 'awaiting_performance'
                ? 'Awaiting streamer declaration'
                : 'Awaiting funding'}
          </dd>
        </div>
      </dl>
      {value.contentAvailability === 'available' && (
        <details>
          <summary>All {value.authors.length} projected author credits</summary>
          <ul>
            {value.authors.map((author, index) => (
              <li key={index}>
                {author.displayName ?? 'Unnamed viewer'} · {author.provider}
              </li>
            ))}
          </ul>
        </details>
      )}
      <section className="contribution-availability" aria-labelledby="payment-availability-heading">
        <h2 id="payment-availability-heading">Contribution availability</h2>
        <p>
          {value.checkoutAvailability.available
            ? 'An available method can prepare checkout. The server rechecks admission before continuing.'
            : reasons[value.checkoutAvailability.reasonCode]}
        </p>
        <ul>
          {value.availablePaymentProviders.map((row) => (
            <li key={row.provider}>
              <strong>{row.provider === 'stripe' ? 'Stripe' : 'PayPal'}</strong>
              <span>
                {row.availability.available
                  ? 'Available for review'
                  : reasons[row.availability.reasonCode]}
              </span>
            </li>
          ))}
        </ul>
        <p className="contribution-muted">
          Refreshing checks the latest server status. It does not create a checkout or send a
          payment.
        </p>
      </section>
      <h2>Accepted terms and funding details</h2>
      <dl className="contribution-details">
        <div>
          <dt>Accepted</dt>
          <dd>{time(value.acceptedAt)} UTC</dd>
        </div>
        <div>
          <dt>Terms version</dt>
          <dd>{value.terms.version}</dd>
        </div>
        <div>
          <dt>Performance rule</dt>
          <dd>Current stream; any authorized continuation is controlled by the server.</dd>
        </div>
        <div>
          <dt>Verified gross contributions</dt>
          <dd>{money(value.funding.confirmedGross, value.terms.goal.currency)}</dd>
        </div>
        <div>
          <dt>Deadline-eligible contributions</dt>
          <dd>{money(value.funding.eligibleGross, value.terms.goal.currency)}</dd>
        </div>
        <div>
          <dt>Late gross</dt>
          <dd>{money(value.funding.lateGross, value.terms.goal.currency)}</dd>
        </div>
        <div>
          <dt>Timing unclassified</dt>
          <dd>{money(value.funding.unclassifiedGross, value.terms.goal.currency)}</dd>
        </div>
        <div>
          <dt>Adjusted gross</dt>
          <dd>{money(value.funding.adjustedGross, value.terms.goal.currency)}</dd>
        </div>
        <div>
          <dt>Held for this challenge</dt>
          <dd>{money(value.funding.remainingContributions, value.terms.goal.currency)}</dd>
        </div>
        <div>
          <dt>Pending checkouts</dt>
          <dd>{value.funding.pendingCheckoutCount}</dd>
        </div>
      </dl>
      {(value.funding.financialReviewRequired || value.funding.adjustmentInconsistent) && (
        <p>
          Financial information needs review. Later adjustments do not rewrite historical goal
          recognition.
        </p>
      )}
      {value.fundingWindow && (
        <p className="contribution-viewer-text">{value.fundingWindow.disclosure}</p>
      )}
      <p className="contribution-muted">
        Completion is a streamer declaration. Funding, payment timing and performance are separate
        records.
      </p>
    </details>
  );
}
