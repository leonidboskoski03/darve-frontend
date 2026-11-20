import {
  CheckoutResponseSchema,
  PayPalQuickOrderInputSchema,
  PayPalQuickOrderResponseSchema,
  PayPalQuickQuoteResponseSchema,
  type PublicChallengeDto,
} from '@/services/contracts/index';
import { failure, type createJsonClient } from '@/services/api/index';
import { CheckoutError, checkoutMessage } from './checkout';

export type QuickPayQuote = ReturnType<typeof PayPalQuickQuoteResponseSchema.parse>;

export function quickPayMinor(decimal: string) {
  const value = decimal.trim();
  if (!/^[0-9]{1,15}(?:\.[0-9]{1,2})?$/.test(value)) return null;
  const [whole = '', fraction = ''] = value.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return minor > 0n ? minor.toString() : null;
}

export function quickPayMessage(error: unknown) {
  const code = error instanceof CheckoutError ? error.problem.code : '';
  if (code === 'GOAL_REACHED') return 'The funding goal has been reached.';
  if (code === 'FUNDING_CLOSED') return 'The funding window has closed.';
  if (code === 'PAYPAL_DECLINED') return 'PayPal declined this payment.';
  if (code === 'PAYPAL_APPROVAL_REQUIRED') return 'Approve this payment in PayPal first.';
  return checkoutMessage(error);
}

export type QuickPayAttempt = {
  key: string;
  publicId: string;
  body: ReturnType<typeof PayPalQuickOrderInputSchema.parse>;
  currency: string;
};

export function createQuickPayCommands(
  publicRequest: ReturnType<typeof createJsonClient>,
  privateRequest: ReturnType<typeof createJsonClient>,
  active: () => void,
) {
  function badResponse(): never {
    throw new CheckoutError(failure('protocol', 'UNEXPECTED_CHECKOUT_RESPONSE'));
  }
  return {
    prepare(
      challenge: PublicChallengeDto,
      amountMinor: string,
      quote: QuickPayQuote,
    ): QuickPayAttempt {
      active();
      return {
        publicId: challenge.publicId,
        key: crypto.randomUUID(),
        currency: quote.currency,
        body: PayPalQuickOrderInputSchema.parse({
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
          '/api/public/challenges/' + publicId + '/paypal-quick/quote?amountMinor=' + amountMinor,
        schema: PayPalQuickQuoteResponseSchema,
        signal,
        success: [200],
      });
      active();
      if (result.kind === 'error') throw new CheckoutError(result);
      return result.kind === 'data' ? result.data : badResponse();
    },
    async create(attempt: QuickPayAttempt) {
      const send = () =>
        privateRequest({
          path: '/api/public/challenges/' + attempt.publicId + '/paypal-quick/orders',
          method: 'POST',
          body: attempt.body,
          idempotencyKey: attempt.key,
          schema: PayPalQuickOrderResponseSchema,
          success: [200, 201],
        });
      active();
      let result = await send();
      active();
      // The server's cookie handshake happens before it can create an order.
      if (result.kind === 'error' && result.code === 'GUEST_PROOF_REQUIRED') {
        result = await send();
        active();
      }
      if (result.kind === 'error') throw new CheckoutError(result);
      return result.kind === 'data' ? result.data.orderId : badResponse();
    },
    async complete(attempt: QuickPayAttempt, orderId: string) {
      active();
      if (!/^[A-Z0-9]{1,32}$/.test(orderId)) return badResponse();
      const result = await privateRequest({
        path: '/api/paypal-quick/orders/' + orderId + '/complete',
        method: 'POST',
        body: {},
        schema: CheckoutResponseSchema,
        success: [200, 202],
      });
      active();
      if (result.kind === 'error') throw new CheckoutError(result);
      if (result.kind !== 'data' && result.kind !== 'pending') return badResponse();
      const receipt = result.data.data;
      if (
        receipt.publicChallengeId !== attempt.publicId ||
        receipt.termsVersion !== attempt.body.termsVersion ||
        receipt.paymentProvider !== 'paypal' ||
        receipt.amount.currency !== attempt.currency ||
        receipt.amount.amountMinor !== attempt.body.amountMinor ||
        receipt.darveFee.amountMinor !== attempt.body.feeMinor ||
        receipt.darveFee.currency !== attempt.currency ||
        receipt.nextAction !== null
      )
        return badResponse();
      return {
        receiptId: receipt.id,
        confirmed: receipt.state === 'succeeded' && receipt.payments.length > 0,
      };
    },
  };
}
