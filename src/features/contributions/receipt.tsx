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
  });
  const receipt = visible && !query.isError && !query.isFetching ? query.data : undefined;
  return (
    <>
      <header className="contribution-heading">
        <span className="contribution-kicker">Only in your private browser</span>
        <h1 ref={heading} tabIndex={-1}>
          Private contribution receipt
        </h1>
        <p>
          Returning from a payment provider does not confirm payment. This page reads the backend's
          current record. Continuing or completing a payment requires your explicit confirmation.
        </p>
      </header>
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
      {!visible ? (
        <p role="status">Private receipt hidden while this page is inactive.</p>
      ) : query.isFetching ? (
        <p role="status">Checking private receipt…</p>
      ) : null}
      {query.error && visible && <p role="alert">{contributionMessage(query.error)}</p>}
      {receipt && (
        <>
          <p className="contribution-muted">
            Snapshot as of {time(receipt.serverTime)}. Refresh for current status.
          </p>
          <section className="contribution-card" aria-labelledby="receipt-state-heading">
            <span className="contribution-kicker">
              {receipt.paymentProvider === 'stripe' ? 'Stripe' : 'PayPal'} contribution
            </span>
            <h2 id="receipt-state-heading">
              {receipt.paymentStatus === 'confirmed'
                ? 'Verified payment recorded'
                : receipt.paymentStatus === 'failed'
                  ? 'Checkout failed'
                  : 'Payment not confirmed'}
            </h2>
            <p>
              {receipt.paymentStatus === 'confirmed'
                ? 'Review each payment’s deadline eligibility below. A verified payment is separate from the funding outcome and streamer performance.'
                : 'No verified payment is present in this receipt. A provider return, approval or pending attempt is not proof of payment.'}
            </p>
            <dl className="contribution-details">
              <div>
                <dt>Requested contribution</dt>
                <dd>{contributionMoney(receipt.amount.amountMinor, receipt.amount.currency)}</dd>
              </div>
              <div>
                <dt>Recorded Darve fee</dt>
                <dd>
                  {contributionMoney(receipt.darveFee.amountMinor, receipt.darveFee.currency)}
                </dd>
              </div>
              <div>
                <dt>Attempt state</dt>
                <dd>{attemptLabels[receipt.state]}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{time(receipt.createdAt)}</dd>
              </div>
            </dl>
            <a href={'/contribute/' + receipt.publicChallengeId}>View the public challenge</a>
          </section>
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
                    : 'Payment timing needs review'}
              </h2>
              <p>
                {payment.eligibility === 'late'
                  ? 'This payment did not qualify toward the funding deadline.'
                  : payment.eligibility === 'unclassified'
                    ? 'Verified money is retained, but deadline eligibility has not been established.'
                    : 'The backend classified this payment as eligible toward the funding deadline.'}
              </p>
              <dl className="contribution-details">
                <div>
                  <dt>Verified amount</dt>
                  <dd>{contributionMoney(payment.amountMinor, receipt.amount.currency)}</dd>
                </div>
                <div>
                  <dt>Paid time</dt>
                  <dd>{time(payment.paidAt)}</dd>
                </div>
                <div>
                  <dt>Eligibility reference</dt>
                  <dd>{time(payment.eligibilityReferenceAt)}</dd>
                </div>
                <div>
                  <dt>Time provenance</dt>
                  <dd>{timingLabels[payment.eligibilityTimeBasis]}</dd>
                </div>
              </dl>
            </section>
          ))}
          <details className="contribution-disclosure">
            <summary>Receipt references</summary>
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
            <p>These identifiers are not access proofs. Keep the private cookie in this browser.</p>
          </details>
        </>
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
