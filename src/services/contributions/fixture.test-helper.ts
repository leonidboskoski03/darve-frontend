// Explicitly synthetic contract evidence, imported only by unit/browser acceptance.
import { PublicChallengeResponseSchema, CheckoutResponseSchema } from '../contracts/index';
export const contributionIds = {
  public: '00112233-1234-4234-8234-112233445566',
  checkout: '11223344-1234-4234-8234-112233445566',
  terms: '22334455-1234-4234-8234-112233445566',
  payment: '33445566-1234-4234-8234-112233445566',
  other: '44556677-1234-4234-8234-112233445566',
};
export const contributionStamp = '2026-11-02T12:00:00.000Z';
export function publicContributionFixture(ready = false) {
  const unavailable = { available: false, reasonCode: 'payments_unconfigured' };
  return PublicChallengeResponseSchema.parse({
    schemaVersion: 1,
    serverTime: contributionStamp,
    data: {
      publicId: contributionIds.public,
      creator: { displayName: 'Synthetic contribution creator' },
      acceptedAt: contributionStamp,
      contentAvailability: 'available',
      terms: {
        version: contributionIds.terms,
        text: 'Draw a creature chosen by the community',
        goal: { amountMinor: '12345', currency: 'EUR' },
        fundingDurationSeconds: 600,
        fundingClosesAt: '2026-11-02T12:10:00.000Z',
        performanceRule: 'current_stream',
        policyVersion: 'synthetic-contribution-v1',
      },
      authors: [
        { provider: 'twitch', displayName: 'Same viewer' },
        { provider: 'youtube', displayName: 'Same viewer' },
        { provider: 'kick', displayName: '<img src=x onerror=alert(1)>' },
      ],
      funding: {
        version: 3,
        revision: 1,
        state: 'pending',
        confirmedGross: '1007',
        eligibleGross: '1000',
        lateGross: '7',
        unclassifiedGross: '0',
        surplusGross: '0',
        refundedGross: '0',
        reversedGross: '0',
        adjustedGross: null,
        remainingContributions: null,
        adjustmentInconsistent: false,
        goalReachedAt: null,
        pendingCheckoutCount: 1,
        reconciliationStatus: 'clear',
        reviewDueAt: '2026-11-02T12:20:00.000Z',
        financialReviewRequired: false,
        timingPolicyVersion: 'funding-v1',
        checkoutAvailability: ready ? { available: true } : unavailable,
      },
      performance: {
        version: 1,
        revision: 1,
        state: 'awaiting_funding',
        startedAt: null,
        declarationId: null,
        declaredAt: null,
        verification: 'streamer_declaration',
        streamContextStatus: 'unobserved',
      },
      checkoutAvailability: ready ? { available: true } : unavailable,
      availablePaymentProviders: [
        { provider: 'stripe', availability: ready ? { available: true } : unavailable },
        { provider: 'paypal', availability: ready ? { available: true } : unavailable },
      ],
      contributionUrl: null,
    },
  });
}
export function privateReceiptFixture(provider: 'stripe' | 'paypal' = 'stripe') {
  return CheckoutResponseSchema.parse({
    schemaVersion: 1,
    serverTime: contributionStamp,
    data: {
      id: contributionIds.checkout,
      publicChallengeId: contributionIds.public,
      termsVersion: contributionIds.terms,
      paymentProvider: provider,
      state: 'awaiting',
      amount: { amountMinor: '9007199254740993', currency: 'EUR' },
      darveFee: { amountMinor: '70', currency: 'EUR' },
      createdAt: contributionStamp,
      nextAction: null,
      payments: [],
    },
  });
}
