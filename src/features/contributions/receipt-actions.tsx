import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import {
  checkoutMessage,
  checkoutUncertain,
  type CaptureAttempt,
  type ContributionRuntime,
  type Receipt,
} from '@/services/contributions/index';

export function ReceiptActions({
  runtime,
  receipt,
  onAcknowledged,
}: {
  runtime: ContributionRuntime;
  receipt: Receipt | undefined;
  onAcknowledged: () => void;
}) {
  const [reviewed, setReviewed] = useState(false),
    [captureConfirmed, setCaptureConfirmed] = useState(false),
    [captureAttempt, setCaptureAttempt] = useState<CaptureAttempt | null>(null),
    [problem, setProblem] = useState<unknown>(null);
  const awaiting =
    !!receipt && receipt.paymentStatus === 'unconfirmed' && receipt.state === 'awaiting';
  const availability = useQuery(
    {
      queryKey: ['public-challenge', receipt?.publicChallengeId],
      enabled: awaiting,
      queryFn: ({ signal }) => runtime.challenge(receipt!.publicChallengeId, signal),
      retry: false,
    },
    runtime.publicQueries,
  );
  const resume = useMutation({
    mutationFn: () => runtime.payments.resume(receipt!),
    retry: false,
    onSuccess: (handoff) => {
      if (handoff.available) runtime.payments.follow(handoff);
      else runtime.refreshPrivate();
    },
  });
  const capture = useMutation({
    mutationFn: (attempt: CaptureAttempt) => runtime.payments.capture(attempt),
    retry: false,
    onSuccess: () => {
      onAcknowledged();
      runtime.refreshPrivate();
    },
  });
  const allowed =
    !availability.isFetching &&
    !availability.isError &&
    availability.data?.data.availablePaymentProviders.some(
      (row) => row.provider === receipt?.paymentProvider && row.availability.available,
    );
  if (!awaiting) return null;
  const error = capture.error ?? resume.error ?? problem,
    uncertain = checkoutUncertain(error),
    busy = capture.isPending || resume.isPending;
  return (
    <section className="contribution-checkout" aria-labelledby="continue-payment-heading">
      <h2 id="continue-payment-heading">Continue this checkout</h2>
      <p>
        Review the contribution amount, recorded Darve fee and accepted terms above. Continuing
        rechecks this same checkout; it does not create a replacement.
      </p>
      {availability.isFetching && <p role="status">Checking current payment availability…</p>}
      {!allowed && !availability.isFetching && (
        <p role="status">
          Payment continuation is unavailable. Refresh the receipt to check the current funding and
          receiving status.
        </p>
      )}
      {allowed && (
        <>
          <label className="contribution-consent">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            <span>
              I reviewed this checkout’s amount, recorded fee and accepted terms and want to
              continue to {receipt.paymentProvider === 'stripe' ? 'Stripe' : 'PayPal'}.
            </span>
          </label>
          <Button
            aria-busy={resume.isPending}
            disabled={!reviewed || !!captureAttempt}
            onClick={() => {
              if (!busy) {
                capture.reset();
                setProblem(null);
                resume.mutate();
              }
            }}
          >
            Continue to {receipt.paymentProvider === 'stripe' ? 'Stripe' : 'PayPal'}
          </Button>
          {receipt.paymentProvider === 'paypal' && (
            <>
              <p>
                If you already approved this order on PayPal, confirm below to request completion.
                Returning here alone does not capture it.
              </p>
              <label className="contribution-consent">
                <input
                  type="checkbox"
                  checked={captureConfirmed}
                  disabled={busy || !!captureAttempt}
                  onChange={(event) => setCaptureConfirmed(event.target.checked)}
                />
                <span>
                  I approved this order on PayPal and confirm completion of the reviewed
                  contribution.
                </span>
              </label>
              <Button
                aria-busy={capture.isPending}
                disabled={
                  !captureConfirmed || (!!captureAttempt && !uncertain && !capture.isPending)
                }
                onClick={() => {
                  if (busy) return;
                  try {
                    resume.reset();
                    setProblem(null);
                    const attempt = captureAttempt ?? runtime.payments.prepareCapture(receipt);
                    setCaptureAttempt(attempt);
                    capture.mutate(attempt);
                  } catch (error) {
                    setProblem(error);
                  }
                }}
              >
                {captureAttempt ? 'Retry same PayPal completion' : 'Complete PayPal payment'}
              </Button>
            </>
          )}
        </>
      )}
      {!!error && <p role="alert">{checkoutMessage(error)}</p>}
      {capture.isSuccess && (
        <p role="status">
          The completion request was checked. Only a verified payment in the canonical receipt
          confirms money.
        </p>
      )}
      {uncertain && (
        <p>
          Refresh the canonical receipt or deliberately retry the same held completion request. Do
          not start another payment to resolve an unknown result.
        </p>
      )}
    </section>
  );
}
