import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import {
  CheckoutError,
  checkoutMessage,
  checkoutUncertain,
  type CheckoutAttempt,
  type ContributionRuntime,
  type PublicChallengeDto,
} from '@/services/contributions/index';

export function CheckoutFlow({
  runtime,
  current,
  onReceipt,
}: {
  runtime: ContributionRuntime;
  current: PublicChallengeDto | null;
  onReceipt: (id: string) => void;
}) {
  const [amount, setAmount] = useState('10.00');
  const [provider, setProvider] = useState<'stripe' | 'paypal' | ''>('');
  const [confirmed, setConfirmed] = useState(false);
  const [held, setHeld] = useState<CheckoutAttempt | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const mutation = useMutation({
    mutationFn: (attempt: CheckoutAttempt) => runtime.payments.create(attempt),
    retry: false,
    onSuccess: (receipt) => {
      runtime.refreshPrivate();
      onReceipt(receipt.id);
    },
  });
  const error = mutation.error ?? problem,
    uncertain = checkoutUncertain(error);
  const proof = error instanceof CheckoutError && error.problem.code === 'GUEST_PROOF_REQUIRED';
  const retry =
    !!held &&
    (uncertain ||
      proof ||
      (error instanceof CheckoutError && error.problem.code === 'RECEIVING_UNAVAILABLE'));
  const methods = held
    ? [held.context.provider]
    : (current?.availablePaymentProviders
        .filter((row) => row.availability.available)
        .map((row) => row.provider) ?? []);
  if (!held && (!current || !current.checkoutAvailability.available)) return null;
  return (
    <section className="contribution-checkout" aria-labelledby="prepare-checkout-heading">
      <h2 id="prepare-checkout-heading">Choose your contribution</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (mutation.isPending) return;
          try {
            setProblem(null);
            if (!confirmed) return;
            let attempt = held;
            if (!attempt) {
              if (!current || !provider) return;
              attempt = runtime.payments.prepare(current, provider, amount);
            }
            setHeld(attempt);
            mutation.mutate(attempt);
          } catch (error) {
            setProblem(error);
          }
        }}
      >
        <fieldset disabled={!!held || mutation.isPending}>
          <legend>Contribution details</legend>
          <label className="ds-field">
            <span className="ds-field__label">
              Amount ({held?.context.currency ?? current?.terms.goal.currency})
            </span>
            <input
              className="ds-input"
              inputMode="decimal"
              value={amount}
              autoComplete="off"
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Payment method</span>
            <select
              className="ds-input"
              value={provider}
              onChange={(event) => setProvider(event.target.value as 'stripe' | 'paypal' | '')}
              required
            >
              <option value="">Choose a method</option>
              {methods.map((method) => (
                <option key={method} value={method}>
                  {method === 'stripe' ? 'Stripe' : 'PayPal'}
                </option>
              ))}
            </select>
          </label>
          {current?.fundingWindow && (
            <p className="contribution-viewer-text">{current.fundingWindow.disclosure}</p>
          )}
          <label className="contribution-consent">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I reviewed this challenge, contribution amount and funding policy. I will review the
              recorded fee on my private receipt before continuing to the payment provider.
            </span>
          </label>
        </fieldset>
        {!!error && <p role="alert">{checkoutMessage(error)}</p>}
        {uncertain && (
          <p>
            Keep this page open to retain the original request. A deliberate retry uses the same
            method, amount, terms and request identity.
          </p>
        )}
        <Button
          type="submit"
          aria-busy={mutation.isPending}
          disabled={!confirmed || (!held && !current) || (!!held && !retry && !mutation.isPending)}
        >
          {held
            ? proof
              ? 'Continue same contribution'
              : 'Retry same preparation'
            : 'Prepare checkout'}
        </Button>
        {held && !retry && !mutation.isPending && (
          <Button
            tone="secondary"
            onClick={() => {
              setHeld(null);
              setConfirmed(false);
              mutation.reset();
              setProblem(null);
              void runtime.publicQueries.invalidateQueries({ queryKey: ['public-challenge'] });
            }}
          >
            Review contribution again
          </Button>
        )}
      </form>
      <p className="contribution-muted">
        Preparing checkout does not confirm a payment. The server checks exact amounts, terms,
        receiving availability and the funding window.
      </p>
    </section>
  );
}
