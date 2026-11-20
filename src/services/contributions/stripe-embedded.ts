import {
  CheckoutResponseSchema,
  StripeEmbeddedQuoteResponseSchema,
  StripeEmbeddedSessionInputSchema,
  StripeEmbeddedSessionResponseSchema,
  type PublicChallengeDto,
} from '@/services/contracts/index';
import { failure, type createJsonClient } from '@/services/api/index';
import { CheckoutError } from './checkout';

type Quote = ReturnType<typeof StripeEmbeddedQuoteResponseSchema.parse>;
export type EmbeddedStripeSession = ReturnType<typeof StripeEmbeddedSessionResponseSchema.parse>;
export type EmbeddedStripeAttempt = {
  key: string;
  publicId: string;
  currency: string;
  publishableKey: string;
  body: ReturnType<typeof StripeEmbeddedSessionInputSchema.parse>;
};

function badResponse(): never {
  throw new CheckoutError(failure('protocol', 'UNEXPECTED_CHECKOUT_RESPONSE'));
}

export function createEmbeddedStripeCommands(
  publicRequest: ReturnType<typeof createJsonClient>,
  privateRequest: ReturnType<typeof createJsonClient>,
  active: () => void,
) {
  return {
    prepare(
      challenge: PublicChallengeDto,
      amountMinor: string,
      quote: Quote,
    ): EmbeddedStripeAttempt {
      return {
        key: crypto.randomUUID(),
        publicId: challenge.publicId,
        currency: quote.currency,
        publishableKey: quote.publishableKey,
        body: StripeEmbeddedSessionInputSchema.parse({
          amountMinor,
          termsVersion: challenge.terms.version,
          agreementId: quote.agreementId,
          feeMinor: quote.feeMinor,
          ...(challenge.fundingWindow
            ? {
                fundingWindow: {
                  version: 1,
                  revision: challenge.fundingWindow.revision,
                  policyVersion: challenge.fundingWindow.policyVersion,
                },
              }
            : {}),
        }),
      };
    },
    async quote(publicId: string, amountMinor: string, signal: AbortSignal) {
      active();
      const result = await publicRequest({
        path:
          '/api/public/challenges/' +
          publicId +
          '/stripe-embedded/quote?amountMinor=' +
          amountMinor,
        schema: StripeEmbeddedQuoteResponseSchema,
        signal,
        success: [200],
      });
      active();
      if (result.kind === 'error') throw new CheckoutError(result);
      return result.kind === 'data' ? result.data : badResponse();
    },
    async create(attempt: EmbeddedStripeAttempt) {
      const send = () =>
        privateRequest({
          path: '/api/public/challenges/' + attempt.publicId + '/stripe-embedded/sessions',
          method: 'POST',
          body: attempt.body,
          idempotencyKey: attempt.key,
          schema: StripeEmbeddedSessionResponseSchema,
          success: [200, 201],
        });
      active();
      let result = await send();
      active();
      if (result.kind === 'error' && result.code === 'GUEST_PROOF_REQUIRED') {
        result = await send();
        active();
      }
      if (result.kind === 'error') throw new CheckoutError(result);
      return result.kind === 'data' ? result.data : badResponse();
    },
    async status(attempt: EmbeddedStripeAttempt, checkoutId: string, signal: AbortSignal) {
      active();
      const result = await privateRequest({
        path: '/api/stripe-embedded/checkouts/' + checkoutId,
        schema: CheckoutResponseSchema,
        signal,
        success: [200],
      });
      active();
      if (result.kind === 'error') throw new CheckoutError(result);
      if (result.kind !== 'data') return badResponse();
      const receipt = result.data.data;
      if (
        receipt.id !== checkoutId ||
        receipt.publicChallengeId !== attempt.publicId ||
        receipt.termsVersion !== attempt.body.termsVersion ||
        receipt.paymentProvider !== 'stripe' ||
        receipt.amount.currency !== attempt.currency ||
        receipt.amount.amountMinor !== attempt.body.amountMinor ||
        receipt.darveFee.currency !== attempt.currency ||
        receipt.darveFee.amountMinor !== attempt.body.feeMinor ||
        receipt.nextAction !== null
      )
        return badResponse();
      return {
        confirmed: receipt.state === 'succeeded' && receipt.payments.length > 0,
        failed: receipt.state === 'failed',
      };
    },
  };
}
