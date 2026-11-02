import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import {
  contributionMessage,
  contributionMoney,
  fundingPercent,
  type ContributionRuntime,
} from '@/services/contributions/index';
import './contributions.css';

const reasons = {
  account_restricted: 'Contributions are unavailable for this creator.',
  source_unavailable: 'The challenge source is unavailable.',
  deadline_passed: 'The funding window has closed.',
  payments_unconfigured: 'Payments are not enabled for this challenge.',
  goal_reached: 'The funding goal has been recognized. New contributions are closed.',
  reconciliation_required:
    'Payment information is being reviewed. New contributions are unavailable.',
};
const money = contributionMoney;
const time = (value: string) =>
  new Intl.DateTimeFormat('en', {
    timeZone: 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
export function Contribution({
  runtime,
  publicId,
}: {
  runtime: ContributionRuntime;
  publicId: string;
}) {
  const query = useQuery(
    {
      queryKey: ['public-challenge', publicId],
      queryFn: ({ signal }) => runtime.challenge(publicId, signal),
      retry: false,
    },
    runtime.publicQueries,
  );
  const value = !query.isError ? query.data?.data : undefined;
  return (
    <>
      <header className="contribution-heading">
        <span className="contribution-kicker">A challenge worth showing up for</span>
        <h1>
          {value?.contentAvailability === 'available'
            ? 'Support ' + (value.creator.displayName ?? 'this creator')
            : 'Support a challenge'}
        </h1>
        <p>
          See the accepted challenge and its current funding status. No Darve account is required to
          view it.
        </p>
      </header>
      <Button
        tone="secondary"
        aria-busy={query.isFetching}
        onClick={() => {
          if (!query.isFetching) void query.refetch();
        }}
      >
        Refresh challenge
      </Button>
      {query.isPending && <p role="status">Loading challenge…</p>}
      {query.error && <p role="alert">{contributionMessage(query.error, 'public')}</p>}
      {value && (
        <>
          <p className="contribution-muted">
            Snapshot as of {time(query.data!.serverTime)} UTC. Refresh for current status.
          </p>
          <section className="contribution-card" aria-labelledby="accepted-challenge-heading">
            <span className="contribution-kicker">Accepted challenge</span>
            <h2 id="accepted-challenge-heading" className="contribution-viewer-text">
              {value.contentAvailability === 'available'
                ? value.terms.text
                : 'Challenge content unavailable'}
            </h2>
            <p className="contribution-raised">
              {money(value.funding.eligibleGross, value.terms.goal.currency)}{' '}
              <span>
                eligible toward a {money(value.terms.goal.amountMinor, value.terms.goal.currency)}{' '}
                goal
              </span>
            </p>
            <progress
              max={100}
              value={fundingPercent(value)}
              aria-label="Deadline-eligible funding toward goal"
            />
            <dl className="contribution-details">
              <div>
                <dt>Funding closes</dt>
                <dd>
                  {time(value.fundingWindow?.effectiveClosesAt ?? value.terms.fundingClosesAt)} UTC
                </dd>
              </div>
              <div>
                <dt>Funding status</dt>
                <dd>
                  {value.funding.state === 'funded'
                    ? 'Goal recognized'
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
          </section>
          <section
            className="contribution-availability"
            aria-labelledby="payment-availability-heading"
          >
            <h2 id="payment-availability-heading">Contribution availability</h2>
            <p role="status">{reasons[value.checkoutAvailability.reasonCode]}</p>
            <ul>
              {value.availablePaymentProviders.map((row) => (
                <li key={row.provider}>
                  <strong>{row.provider === 'stripe' ? 'Stripe' : 'PayPal'}</strong>
                  <span>{reasons[row.availability.reasonCode]}</span>
                </li>
              ))}
            </ul>
            <p className="contribution-muted">
              Refreshing checks the latest server status. It does not create a checkout or send a
              payment.
            </p>
          </section>
          <details className="contribution-disclosure">
            <summary>Accepted terms and funding details</summary>
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
                <dt>Remaining contributions</dt>
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
              Completion is a streamer declaration. Funding, payment timing and performance are
              separate records.
            </p>
          </details>
        </>
      )}
      <p className="contribution-footnote">
        Already contributed? <a href="/receipts">Check a private receipt</a> in the original
        browser.
      </p>
    </>
  );
}
