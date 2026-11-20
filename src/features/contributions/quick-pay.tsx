import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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

const sdkError = 'Quick Pay could not open. You can use the checkout options below.';
type Progress = 'idle' | 'opening' | 'capturing' | 'cancelled' | 'pending' | 'confirmed';

export function QuickPay({
  runtime,
  challenge,
}: {
  runtime: ContributionRuntime;
  challenge: PublicChallengeDto | null;
}) {
  const [amount, setAmount] = useState('');
  const [reviewedKey, setReviewedKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const [sdkStatus, setSdkStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const amountMinor = quickPayMinor(amount);
  const wallet = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const attempt = useRef<QuickPayAttempt | null>(null);
  const orderPromise = useRef<Promise<string> | null>(null);
  const order = useRef<string | null>(null);
  const capturePromise = useRef<Promise<void> | null>(null);
  const publicId = challenge?.publicId;
  const available =
    challenge?.availablePaymentProviders.some(
      (provider) => provider.provider === 'paypal' && provider.availability.available,
    ) ?? false;
  const quoteQuery = useQuery(
    {
      queryKey: ['paypal-quick-quote', publicId, amountMinor],
      enabled: !!publicId && !!amountMinor && available && !locked,
      queryFn: ({ signal }) => runtime.quickPay.quote(publicId!, amountMinor!, signal),
      retry: false,
      staleTime: 30000,
    },
    runtime.publicQueries,
  );
  const quote =
    quoteQuery.data?.currency === challenge?.terms.goal.currency ? quoteQuery.data : undefined;
  const reviewKey =
    quote && challenge && amountMinor
      ? [
          challenge.publicId,
          challenge.terms.version,
          challenge.fundingWindow?.revision,
          quote.agreementId,
          quote.feeMinor,
          amountMinor,
        ].join(':')
      : null;
  const reviewed = reviewKey !== null && reviewedKey === reviewKey;
  const setup = useRef({ reviewed, challenge, amountMinor, quote, available });
  useEffect(() => {
    setup.current = { reviewed, challenge, amountMinor, quote, available };
  }, [reviewed, challenge, amountMinor, quote, available]);

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
    setLocked(true);
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
          <strong>Payment confirmed.</strong> <a href={'/receipts/' + receiptId}>Private receipt</a>
        </p>
      ) : (
        <>
          <label className="ds-field">
            <span className="ds-field__label">
              Quick amount ({challenge?.terms.goal.currency ?? currency})
            </span>
            <input
              className="ds-input"
              inputMode="decimal"
              placeholder="10.00"
              autoComplete="off"
              value={amount}
              disabled={locked}
              onChange={(event) => {
                setAmount(event.target.value);
                setReviewedKey(null);
              }}
            />
          </label>
          {quoteQuery.isFetching && <p role="status">Checking the fee…</p>}
          {quoteQuery.error && <p role="alert">{quickPayMessage(quoteQuery.error)}</p>}
          {quote && (
            <label className="contribution-consent">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={locked}
                onChange={(event) => setReviewedKey(event.target.checked ? reviewKey : null)}
              />
              <span>
                I accept the challenge terms and fee of{' '}
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
          {progress === 'capturing' && <p role="status">Confirming payment…</p>}
          {progress === 'cancelled' && (
            <p role="status">PayPal was closed. You can retry this checkout.</p>
          )}
          {problem && <p role="alert">{problem}</p>}
          {progress === 'pending' && (
            <>
              {!problem && <p role="status">PayPal is still confirming this payment.</p>}
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
