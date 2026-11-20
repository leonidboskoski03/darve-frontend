import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import {
  contributionMessage,
  contributionMoney,
  type ContributionRuntime,
} from '@/services/contributions/index';
import './contributions.css';
import { ChallengeDetails } from './challenge-details';
import { ChallengeSummary } from './challenge-summary';
import { CheckoutFlow } from './checkout-flow';
import { AmountPicker } from './primary-amount';
import { usePrimaryQuotes } from './primary-quotes';
import { QuickPay } from './quick-pay';
import { StripeEmbedded } from './stripe-embedded';

export function Contribution({
  runtime,
  publicId,
  onReceipt,
}: {
  runtime: ContributionRuntime;
  publicId: string;
  onReceipt: (id: string) => void;
}) {
  const [amount, setAmount] = useState({ text: '', revision: 0 });
  const query = useQuery(
    {
      queryKey: ['public-challenge', publicId],
      queryFn: ({ signal }) => runtime.challenge(publicId, signal),
      retry: false,
      refetchInterval: ({ state }) =>
        state.data?.data.funding.state === 'pending' && !state.error && state.dataUpdateCount <= 24
          ? 5_000
          : false,
    },
    runtime.publicQueries,
  );
  const read = !query.isError ? query.data : undefined;
  const value = read?.data;
  const quotes = usePrimaryQuotes(runtime, value, amount.text);
  const fees = [quotes.paypal.data, quotes.stripe.data].map((quote) =>
    quote && value && quote.currency === value.terms.goal.currency
      ? contributionMoney(quote.feeMinor, quote.currency)
      : null,
  );
  const [paypalFee, stripeFee] = fees;
  const sharedFee = paypalFee ?? stripeFee;
  const fee =
    paypalFee && stripeFee && paypalFee !== stripeFee
      ? 'Darve fee: PayPal ' + paypalFee + ' / Stripe ' + stripeFee
      : sharedFee
        ? 'Includes ' + sharedFee + ' Darve fee'
        : null;
  const refresh = query.refetch;
  const closesAt = value?.fundingWindow?.effectiveClosesAt ?? value?.terms.fundingClosesAt;
  const serverTime = read?.serverTime;
  const pending = value?.funding.state === 'pending';
  useEffect(() => {
    if (!pending || !serverTime || !closesAt) return;
    const remaining = Date.parse(closesAt) - Date.parse(serverTime);
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => void refresh(), Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [pending, serverTime, closesAt, refresh]);
  return (
    <>
      {read ? (
        <ChallengeSummary
          value={read.data}
          serverTime={read.serverTime}
          updatedAt={query.dataUpdatedAt}
        />
      ) : (
        <header className="contribution-heading">
          <h1>Support a challenge</h1>
          {query.isPending && <p role="status">Loading challenge…</p>}
          {query.error && <p role="alert">{contributionMessage(query.error, 'public')}</p>}
          {query.isError && (
            <Button tone="secondary" onClick={() => void refresh()}>
              Refresh challenge
            </Button>
          )}
        </header>
      )}
      {value?.checkoutAvailability.available && (
        <AmountPicker
          amount={amount.text}
          currency={value.terms.goal.currency}
          onAmount={(text) => setAmount((current) => ({ text, revision: current.revision + 1 }))}
        />
      )}
      {read && (
        <ChallengeDetails
          value={read.data}
          serverTime={read.serverTime}
          fee={fee}
          refreshing={query.isFetching}
          refresh={() => void refresh()}
        />
      )}
      <QuickPay
        runtime={runtime}
        challenge={value ?? null}
        picked={amount}
        quoteQuery={quotes.paypal}
      />
      <StripeEmbedded
        runtime={runtime}
        challenge={value ?? null}
        picked={amount}
        quoteQuery={quotes.stripe}
      />
      <CheckoutFlow runtime={runtime} current={value ?? null} onReceipt={onReceipt} />
      <p className="contribution-footnote">
        Already contributed? <a href="/receipts">Find your receipt</a> in the original browser.
      </p>
    </>
  );
}
