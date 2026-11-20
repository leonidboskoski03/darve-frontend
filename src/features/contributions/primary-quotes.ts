import { useQuery } from '@tanstack/react-query';
import {
  quickPayMinor,
  type ContributionRuntime,
  type PublicChallengeDto,
} from '@/services/contributions/index';
export type PrimaryAmount = { text: string; revision: number };

export function usePrimaryQuotes(
  runtime: ContributionRuntime,
  challenge: PublicChallengeDto | undefined,
  amount: string,
) {
  const amountMinor = quickPayMinor(amount);
  const publicId = challenge?.publicId;
  const enabled = (provider: 'paypal' | 'stripe') =>
    !!publicId &&
    !!amountMinor &&
    (challenge?.availablePaymentProviders.some(
      (row) => row.provider === provider && row.availability.available,
    ) ??
      false);
  const paypal = useQuery(
    {
      queryKey: ['paypal-quick-quote', publicId, amountMinor],
      enabled: enabled('paypal'),
      queryFn: ({ signal }) => runtime.quickPay.quote(publicId!, amountMinor!, signal),
      retry: false,
      staleTime: 30_000,
    },
    runtime.publicQueries,
  );
  const stripe = useQuery(
    {
      queryKey: ['stripe-embedded-quote', publicId, amountMinor],
      enabled: enabled('stripe'),
      queryFn: ({ signal }) => runtime.embeddedStripe.quote(publicId!, amountMinor!, signal),
      retry: false,
    },
    runtime.publicQueries,
  );
  return { paypal, stripe };
}
export type PrimaryQuotes = ReturnType<typeof usePrimaryQuotes>;
