import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import {
  contributionMessage,
  contributionMoney,
  validReceiptId,
  type ContributionRuntime,
} from '@/services/contributions/index';
import './contributions.css';
import { ReceiptActions } from './receipt-actions';

const attemptLabels = {
  prepared: 'Prepared',
  creating: 'Creating',
  unknown: 'Outcome unknown',
  reconciling: 'Reconciling',
  awaiting: 'Awaiting confirmation',
  failed: 'Failed',
  succeeded: 'Succeeded',
};
const timingLabels = {
  provider_success_time: 'Provider success time',
  stripe_success_event: 'Stripe success-event reference',
  paypal_success_event: 'PayPal success-event reference',
  unknown: 'Timing not established',
};
const time = (value: string | null) =>
  value === null
    ? 'Not supplied'
    : new Intl.DateTimeFormat('en', {
        timeZone: 'UTC',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value)) + ' UTC';
export function ReceiptLookup({ onOpen }: { onOpen: (id: string) => void }) {
  const [id, setId] = useState(''),
    [invalid, setInvalid] = useState(false);
  return (
    <>
      <header className="contribution-heading">
        <span className="contribution-kicker">Your contribution record</span>
        <h1>Find a private receipt</h1>
        <p>
          Use the checkout reference from your contribution and the same browser. The private
          browser cookie is required; a reference alone grants no access.
        </p>
      </header>
      <form
        className="contribution-lookup"
        onSubmit={(event) => {
          event.preventDefault();
          if (!validReceiptId(id.trim())) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          onOpen(id.trim());
        }}
      >
        <label className="ds-field">
          <span className="ds-field__label">Checkout reference</span>
          <input
            className="ds-input"
            value={id}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? 'receipt-reference-error' : undefined}
            onChange={(event) => {
              setId(event.target.value);
              setInvalid(false);
            }}
            required
          />
        </label>
        {invalid && (
          <p id="receipt-reference-error" role="alert">
            Enter a valid checkout reference.
          </p>
        )}
        <Button type="submit">Open private receipt</Button>
      </form>
      <p className="contribution-muted">
        Darve cannot restore a missing private cookie from this reference. No sign-in or payment is
        performed here.
      </p>
    </>
  );
}
export function PrivateReceipt({
  runtime,
  id,
  visible,
  revision,
}: {
  runtime: ContributionRuntime;
  id: string;
  visible: boolean;
  revision: number;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const query = useQuery({
    queryKey: runtime.scope.key(['receipt', id, revision]),
    queryFn: ({ signal }) => runtime.receipt(id, signal),
    enabled: visible,
    retry: false,
    gcTime: 0,
    refetchInterval: ({ state }) => {
      if (!visible || state.error || !state.data || state.dataUpdateCount > 24) return false;
      const receipt = state.data;
      return receipt.paymentStatus !== 'failed' &&
        (receipt.paymentStatus !== 'confirmed' ||
          receipt.verifiedPayments.some((payment) => payment.eligibility === 'unclassified'))
        ? 5_000
        : false;
    },
  });
  const receipt = visible && !query.isError ? query.data : undefined;
  const publicId = receipt?.publicChallengeId;
  const challenge = useQuery(
    {
      queryKey: ['public-challenge', publicId],
      enabled: !!publicId,
      queryFn: ({ signal }) => runtime.challenge(publicId!, signal),
      retry: false,
    },
    runtime.publicQueries,
  ).data?.data;
  return (
    <>
      <header className="contribution-heading">
        <h1 ref={heading} tabIndex={-1}>
          Private contribution receipt
        </h1>
      </header>
      {query.isError && visible && (
        <Button
          tone="secondary"
          aria-busy={visible && query.isFetching}
          disabled={!visible}
          onClick={() => {
            if (!query.isFetching) runtime.refreshPrivate();
          }}
        >
          Refresh receipt
        </Button>
      )}
      {!visible ? (
        <p role="status">Private receipt hidden while this page is inactive.</p>
      ) : query.isFetching ? (
        <p role="status">Checking private receipt…</p>
      ) : null}
      {query.error && visible && <p role="alert">{contributionMessage(query.error)}</p>}
      {receipt && (
        <section className="contribution-card" aria-labelledby="receipt-state-heading">
          <span className="contribution-kicker">
            {receipt.paymentProvider === 'stripe' ? 'Stripe' : 'PayPal'} contribution
          </span>
          <h2 id="receipt-state-heading">
            {receipt.paymentStatus === 'confirmed'
              ? 'Payment confirmed'
              : receipt.paymentStatus === 'failed'
                ? 'Checkout failed'
                : 'Confirming a payment…'}
          </h2>
          <dl className="contribution-details">
            <div>
              <dt>Contribution</dt>
              <dd>{contributionMoney(receipt.amount.amountMinor, receipt.amount.currency)}</dd>
            </div>
            <div>
              <dt>Darve fee</dt>
              <dd>{contributionMoney(receipt.darveFee.amountMinor, receipt.darveFee.currency)}</dd>
            </div>
            <div>
              <dt>{receipt.verifiedPayments[0]?.paidAt ? 'Paid' : 'Checkout started'}</dt>
              <dd>{time(receipt.verifiedPayments[0]?.paidAt ?? receipt.createdAt)}</dd>
            </div>
          </dl>
          <a href={'/contribute/' + receipt.publicChallengeId}>
            {challenge?.terms.text ?? 'View the public challenge'}
          </a>
          {receipt.verifiedPayments.some((payment) => payment.eligibility === 'unclassified') && (
            <p>We’re checking whether this payment counts toward the goal.</p>
          )}
        </section>
      )}
      {visible && !query.isError && (
        <details className="contribution-disclosure">
          <summary>Receipt details</summary>
          <Button
            tone="secondary"
            aria-busy={query.isFetching}
            onClick={() => {
              if (!query.isFetching) runtime.refreshPrivate();
            }}
          >
            Refresh receipt
          </Button>
          {receipt && (
            <>
              <p className="contribution-muted">
                Snapshot as of {time(receipt.serverTime)}. Refresh for current status.
              </p>
              <p>
                Returning from a payment provider does not confirm payment. Continuing or completing
                a payment requires your explicit confirmation.
              </p>
              <p>
                {receipt.paymentStatus === 'confirmed'
                  ? 'Review each payment’s deadline eligibility below. A verified payment is separate from the funding outcome and streamer performance.'
                  : 'No verified payment is present in this receipt. A provider return, approval or pending attempt is not proof of payment.'}
              </p>
              <dl className="contribution-details">
                <div>
                  <dt>Attempt state</dt>
                  <dd>{attemptLabels[receipt.state]}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{time(receipt.createdAt)}</dd>
                </div>
              </dl>
              {receipt.verifiedPayments.map((payment) => (
                <section
                  className="contribution-card"
                  key={payment.id}
                  aria-label="Verified payment timing"
                >
                  <h2>
                    {payment.eligibility === 'eligible'
                      ? 'Deadline eligible'
                      : payment.eligibility === 'late'
                        ? 'Received outside the funding deadline'
                        : 'Payment received, confirming funding eligibility…'}
                  </h2>
                  <p>
                    {payment.eligibility === 'late'
                      ? 'This payment did not qualify toward the funding deadline.'
                      : payment.eligibility === 'unclassified'
                        ? 'We’ve received your payment and are checking whether it counts toward the goal.'
                        : 'The backend classified this payment as eligible toward the funding deadline.'}
                  </p>
                  <dl className="contribution-details">
                    <div>
                      <dt>Verified amount</dt>
                      <dd>{contributionMoney(payment.amountMinor, receipt.amount.currency)}</dd>
                    </div>
                    {payment.paidAt && (
                      <div>
                        <dt>Paid time</dt>
                        <dd>{time(payment.paidAt)}</dd>
                      </div>
                    )}
                    {payment.eligibilityReferenceAt && (
                      <div>
                        <dt>Funding eligibility checked against</dt>
                        <dd>
                          {time(payment.eligibilityReferenceAt)} ·{' '}
                          {timingLabels[payment.eligibilityTimeBasis]}
                        </dd>
                      </div>
                    )}
                  </dl>
                </section>
              ))}
              <h2>Receipt references</h2>
              <dl className="contribution-details">
                <div>
                  <dt>Checkout</dt>
                  <dd>{receipt.id}</dd>
                </div>
                <div>
                  <dt>Accepted terms</dt>
                  <dd>{receipt.termsVersion}</dd>
                </div>
              </dl>
              <p>
                These identifiers are not access proofs. Keep the private cookie in this browser.
              </p>
            </>
          )}
        </details>
      )}
      <ReceiptActions
        runtime={runtime}
        receipt={receipt}
        onAcknowledged={() => heading.current?.focus()}
      />
      <p className="contribution-footnote">
        <a href="/receipts">Look up another receipt</a>
      </p>
    </>
  );
}
