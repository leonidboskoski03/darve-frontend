import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import {
  CheckoutError,
  checkoutUncertain,
  contributionMoney,
  loadStripeSdk,
  quickPayMessage,
  quickPayMinor,
  type ContributionRuntime,
  type EmbeddedStripeAttempt,
  type EmbeddedStripeSession,
  type PublicChallengeDto,
} from '@/services/contributions/index';
import type { PrimaryAmount, PrimaryQuotes } from './primary-quotes';

export function StripeEmbedded({
  runtime,
  challenge,
  picked,
  quoteQuery,
}: {
  runtime: ContributionRuntime;
  challenge: PublicChallengeDto | null;
  picked: PrimaryAmount;
  quoteQuery: PrimaryQuotes['stripe'];
}) {
  const [heldQuote, setHeldQuote] = useState<PrimaryQuotes['stripe']['data']>();
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<EmbeddedStripeAttempt | null>(null);
  const [session, setSession] = useState<EmbeddedStripeSession | null>(null);
  const [checkingUntil, setCheckingUntil] = useState(0);
  const [formFailed, setFormFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const slot = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const amountMinor = quickPayMinor(picked.text);
  const available = challenge?.availablePaymentProviders.some(
    ({ provider, availability }) => provider === 'stripe' && availability.available,
  );
  const responseQuote = attempt ? heldQuote : quoteQuery.data;
  const quote =
    responseQuote?.currency === challenge?.terms.goal.currency ? responseQuote : undefined;
  const reviewKey =
    quote && challenge && amountMinor
      ? [
          challenge.terms.version,
          challenge.fundingWindow?.revision,
          quote.agreementId,
          quote.feeMinor,
          quote.connectedAccountId,
          amountMinor,
          picked.revision,
        ].join(':')
      : null;
  const accepted = reviewKey !== null && reviewed === reviewKey;
  const checkoutId = session?.checkoutId;
  const status = useQuery(
    {
      enabled: !!attempt && !!checkoutId && checkingUntil > 0,
      queryKey: ['stripe-embedded-status', checkoutId],
      queryFn: ({ signal }) => runtime.embeddedStripe.status(attempt!, checkoutId!, signal),
      retry: false,
      refetchInterval: ({ state }) =>
        Date.now() < checkingUntil && !state.data?.confirmed && !state.data?.failed ? 4000 : false,
      gcTime: 0,
    },
    runtime.publicQueries,
  );
  const confirmed = !!status.data?.confirmed;
  const publicId = attempt?.publicId;
  useEffect(() => {
    if (confirmed && publicId) {
      runtime.refreshPrivate();
      void runtime.publicQueries.invalidateQueries({ queryKey: ['public-challenge', publicId] });
    }
  }, [confirmed, publicId, runtime]);

  const publishableKey = attempt?.publishableKey;
  const connectedAccountId = session?.mount?.connectedAccountId;
  const clientSecret = session?.mount?.clientSecret;
  useEffect(() => {
    const target = slot.current;
    if (!publishableKey || !connectedAccountId || !clientSecret || !target || checkingUntil) return;
    let disposed = false;
    let mounted: { destroy(): void } | undefined;
    void loadStripeSdk()
      .then(async (stripe) => {
        if (disposed) return;
        const page = await stripe(publishableKey, {
          stripeAccount: connectedAccountId,
        }).createEmbeddedCheckoutPage({
          fetchClientSecret: () => Promise.resolve(clientSecret),
          onComplete: () => {
            if (!disposed) setCheckingUntil(Date.now() + 60000);
          },
        });
        if (disposed) {
          page.destroy();
          return;
        }
        mounted = page;
        page.mount(target);
      })
      .catch(() => {
        if (!disposed) setFormFailed(true);
      });
    return () => {
      disposed = true;
      mounted?.destroy();
    };
  }, [publishableKey, connectedAccountId, clientSecret, checkingUntil]);

  async function start() {
    if (submitting.current || session) return;
    const reviewedAttempt =
      attempt ??
      (accepted && challenge && amountMinor && quote
        ? runtime.embeddedStripe.prepare(challenge, amountMinor, quote)
        : null);
    if (!reviewedAttempt) return;
    submitting.current = true;
    setHeldQuote(quote);
    setAttempt(reviewedAttempt);
    setOpening(true);
    setProblem(null);
    try {
      const result = await runtime.embeddedStripe.create(reviewedAttempt);
      setSession(result);
      if (!result.mount) setCheckingUntil(Date.now() + 60000);
    } catch (error) {
      if (error instanceof CheckoutError && error.problem.code === 'EMBEDDED_SESSION_NOT_OPENED') {
        setProblem('Couldn’t open the card form. Nothing was charged. Try again.');
        setAttempt(null);
      } else {
        setProblem(quickPayMessage(error));
        if (!checkoutUncertain(error)) {
          setAttempt(null);
          setReviewed(null);
          void quoteQuery.refetch();
        }
      }
    } finally {
      submitting.current = false;
      setOpening(false);
    }
  }
  if (!available && !attempt) return null;
  return (
    <section className="contribution-checkout" aria-labelledby="stripe-embedded-heading">
      <h2 id="stripe-embedded-heading">Pay on this page (card / Apple Pay / Google Pay)</h2>
      {confirmed ? (
        <p role="status">
          <strong>Payment confirmed</strong> — <a href={'/receipts/' + checkoutId}>View receipt</a>
        </p>
      ) : (
        <>
          {!session && (
            <>
              {!attempt && quoteQuery.isFetching && <p role="status">Checking the fee…</p>}
              {!attempt && quoteQuery.error && (
                <p role="alert">{quickPayMessage(quoteQuery.error)}</p>
              )}
              {quote && (
                <label className="contribution-consent">
                  <input
                    type="checkbox"
                    checked={!!attempt || accepted}
                    disabled={!!attempt}
                    onChange={(event) => setReviewed(event.target.checked ? reviewKey : null)}
                  />
                  <span>
                    I accept the challenge terms and Stripe contribution fee of{' '}
                    {contributionMoney(quote.feeMinor, quote.currency)}.
                  </span>
                </label>
              )}
              <Button
                onClick={() => {
                  void start();
                }}
                disabled={opening || (!accepted && !attempt)}
              >
                {opening
                  ? 'Opening Stripe…'
                  : attempt
                    ? 'Retry opening this checkout'
                    : 'Open card form'}
              </Button>
              {problem && <p role="alert">{problem}</p>}
            </>
          )}
          {session?.mount && !checkingUntil && !formFailed && <div ref={slot} />}
          {formFailed && (
            <p role="alert">
              Stripe could not open the form. Check this payment before trying another.
            </p>
          )}
          {status.data?.failed && <p role="alert">Stripe did not confirm this payment.</p>}
          {checkingUntil > 0 && !status.data?.failed && <p role="status">Confirming a payment…</p>}
          {status.error && <p role="alert">{quickPayMessage(status.error)}</p>}
          {checkoutId && (checkingUntil > 0 || formFailed) && !status.data?.failed && (
            <Button
              tone="secondary"
              disabled={status.isFetching}
              onClick={() => {
                setCheckingUntil(Date.now() + 60000);
                void status.refetch();
              }}
            >
              Check this payment
            </Button>
          )}
        </>
      )}
    </section>
  );
}
