import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/design-system/button';
import {
  contributionMoney,
  loadQuickPaySdk,
  quickPayMessage,
  quickPayMinor,
  type ContributionRuntime,
  type PublicChallengeDto,
  type QuickPayAttempt,
} from '@/services/contributions/index';
import type { PrimaryAmount, PrimaryQuotes } from './primary-quotes';

const sdkError = 'Quick Pay could not open. You can use the checkout options below.';
type Progress = 'idle' | 'opening' | 'capturing' | 'cancelled' | 'pending' | 'confirmed';

export function QuickPay({
  runtime,
  challenge,
  picked,
  quoteQuery,
}: {
  runtime: ContributionRuntime;
  challenge: PublicChallengeDto | null;
  picked: PrimaryAmount;
  quoteQuery: PrimaryQuotes['paypal'];
}) {
  const [reviewedKey, setReviewedKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const [sdkStatus, setSdkStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [held, setHeld] = useState<{
    picked: PrimaryAmount;
    quote: PrimaryQuotes['paypal']['data'];
  }>();
  const locked = !!held;
  const amount = held?.picked ?? picked;
  const amountMinor = quickPayMinor(amount.text);
  const wallet = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const attempt = useRef<QuickPayAttempt | null>(null);
  const orderPromise = useRef<Promise<string> | null>(null);
  const order = useRef<string | null>(null);
  const capturePromise = useRef<Promise<void> | null>(null);
  const available =
    challenge?.availablePaymentProviders.some(
      (provider) => provider.provider === 'paypal' && provider.availability.available,
    ) ?? false;
  const responseQuote = held?.quote ?? quoteQuery.data;
  const quote =
    responseQuote?.currency === challenge?.terms.goal.currency ? responseQuote : undefined;
  const reviewKey =
    quote && challenge && amountMinor
      ? [
          challenge.publicId,
          challenge.terms.version,
          challenge.fundingWindow?.revision,
          quote.agreementId,
          quote.feeMinor,
          amountMinor,
          amount.revision,
        ].join(':')
      : null;
  const reviewed = reviewKey !== null && reviewedKey === reviewKey;
  const setup = useRef({ reviewed, challenge, amountMinor, quote, available, amount });
  useEffect(() => {
    setup.current = { reviewed, challenge, amountMinor, quote, available, amount };
  }, [reviewed, challenge, amountMinor, quote, available, amount]);

  const createOrder = useCallback(() => {
    if (orderPromise.current) return orderPromise.current;
    const current = setup.current;
    if (
      !current.reviewed ||
      !current.challenge ||
      !current.amountMinor ||
      !current.quote ||
      !current.available
    )
      return Promise.reject(new Error('Review the amount and fee before continuing'));
    const held =
      attempt.current ??
      runtime.quickPay.prepare(current.challenge, current.amountMinor, current.quote);
    attempt.current = held;
    setHeld({ picked: current.amount, quote: current.quote });
    setProblem(null);
    setProgress('opening');
    orderPromise.current = runtime.quickPay
      .create(held)
      .then((id) => {
        order.current = id;
        return id;
      })
      .catch((error: unknown) => {
        orderPromise.current = null;
        setProgress('idle');
        setProblem(quickPayMessage(error));
        throw error;
      });
    return orderPromise.current;
  }, [runtime]);

  const capture = useCallback(
    (orderId: string) => {
      if (capturePromise.current) return capturePromise.current;
      const held = attempt.current;
      if (!held || !order.current || order.current !== orderId) {
        setProblem('This PayPal approval could not be matched to your checkout.');
        setProgress('idle');
        return Promise.resolve();
      }
      setProgress('capturing');
      setProblem(null);
      capturePromise.current = runtime.quickPay
        .complete(held, orderId)
        .then((result) => {
          setReceiptId(result.receiptId);
          setProgress(result.confirmed ? 'confirmed' : 'pending');
          runtime.refreshPrivate();
          void runtime.publicQueries.invalidateQueries({
            queryKey: ['public-challenge', held.publicId],
          });
        })
        .catch((error: unknown) => {
          setProgress('pending');
          setProblem(quickPayMessage(error));
        })
        .finally(() => {
          capturePromise.current = null;
        });
      return capturePromise.current;
    },
    [runtime],
  );

  const clientId = quote?.clientId,
    merchantId = quote?.merchantId,
    currency = quote?.currency,
    attributionId = quote?.attributionId;
  const showButtons = reviewed && progress !== 'confirmed' && progress !== 'pending';
  useEffect(() => {
    if (
      !showButtons ||
      !clientId ||
      !merchantId ||
      !currency ||
      !attributionId ||
      !wallet.current ||
      !card.current
    )
      return;
    const walletSlot = wallet.current,
      cardSlot = card.current;
    const buttons: { close(): Promise<void> }[] = [];
    let disposed = false;
    setSdkStatus('loading');
    void loadQuickPaySdk(clientId, merchantId, currency, attributionId)
      .then(async (sdk) => {
        if (disposed) return;
        const options = {
          createOrder,
          onApprove: ({ orderID }: { orderID: string }) => capture(orderID),
          onCancel: () => {
            setProgress('cancelled');
            setProblem(null);
          },
          onError: () => {
            setProgress('idle');
            setProblem((current) => current ?? sdkError);
          },
        };
        const render = async (fundingSource: string, target: HTMLDivElement) => {
          const button = sdk.Buttons({ ...options, fundingSource });
          if (!button.isEligible()) return false;
          buttons.push(button);
          await button.render(target);
          return true;
        };
        const rendered = await Promise.allSettled([
          render(sdk.FUNDING.PAYPAL, walletSlot),
          render(sdk.FUNDING.CARD, cardSlot),
        ]);
        if (!disposed)
          setSdkStatus(
            rendered.some((r) => r.status === 'fulfilled' && r.value) ? 'ready' : 'unavailable',
          );
      })
      .catch(() => {
        if (!disposed) setSdkStatus('unavailable');
      });
    return () => {
      disposed = true;
      for (const button of buttons) void button.close().catch(() => undefined);
    };
  }, [showButtons, clientId, merchantId, currency, attributionId, createOrder, capture]);

  if (!available && !locked) return null;
  return (
    <section className="contribution-checkout" aria-labelledby="quick-pay-heading">
      <h2 id="quick-pay-heading">Quick Pay</h2>
      {progress === 'confirmed' ? (
        <p role="status">
          <strong>Payment confirmed</strong> — <a href={'/receipts/' + receiptId}>View receipt</a>
        </p>
      ) : (
        <>
          {!locked && quoteQuery.isFetching && <p role="status">Checking the fee…</p>}
          {!locked && quoteQuery.error && <p role="alert">{quickPayMessage(quoteQuery.error)}</p>}
          {quote && (
            <label className="contribution-consent">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={locked}
                onChange={(event) => setReviewedKey(event.target.checked ? reviewKey : null)}
              />
              <span>
                I accept the challenge terms and PayPal contribution fee of{' '}
                {contributionMoney(quote.feeMinor, quote.currency)}.
              </span>
            </label>
          )}
          {showButtons && (
            <>
              {sdkStatus === 'loading' && <p role="status">Loading PayPal…</p>}
              {sdkStatus === 'unavailable' && <p role="alert">{sdkError}</p>}
              <div ref={wallet} />
              <div ref={card} />
            </>
          )}
          {progress === 'opening' && <p role="status">Opening PayPal…</p>}
          {progress === 'capturing' && <p role="status">Confirming a payment…</p>}
          {progress === 'cancelled' && (
            <p role="status">PayPal was closed. You can retry this checkout.</p>
          )}
          {problem && <p role="alert">{problem}</p>}
          {progress === 'pending' && (
            <>
              {!problem && <p role="status">Confirming a payment…</p>}
              {receiptId && <a href={'/receipts/' + receiptId}>Private receipt</a>}
              <Button
                tone="secondary"
                onClick={() => {
                  if (order.current) void capture(order.current);
                }}
              >
                Check same payment
              </Button>
            </>
          )}
        </>
      )}
    </section>
  );
}
