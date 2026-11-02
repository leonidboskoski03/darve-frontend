import {
  CheckoutInputSchema,
  CheckoutCompleteInputSchema,
  CheckoutKeySchema,
  CheckoutResponseSchema,
  PaymentProviderSchema,
  contributionAmountMinor,
  checkoutConsumerView,
  type PublicChallengeDto,
} from '@/services/contracts/index';
import { failure, type createJsonClient, type ApiFailure } from '@/services/api/index';
import type { Receipt } from './client';

type Provider = 'stripe' | 'paypal';
type Context = Readonly<{
  id?: string;
  publicId: string;
  terms: string;
  provider: Provider;
  amount: string;
  currency: string;
}>;
export type CheckoutAttempt = Readonly<{
  type: 'create';
  key: string;
  context: Context;
  body: Readonly<ReturnType<typeof CheckoutInputSchema.parse>>;
}>;
export type CaptureAttempt = Readonly<{
  type: 'capture';
  key: string;
  context: Context;
  body: Readonly<Record<string, never>>;
}>;
export type Handoff = Readonly<{ receipt: Receipt; available: boolean }>;
export class CheckoutError extends Error {
  constructor(readonly problem: ApiFailure) {
    super('Checkout result could not be confirmed.');
  }
}
function reject(code: string, category: ApiFailure['category'] = 'configuration'): never {
  throw new CheckoutError(failure(category, code));
}
export function checkoutUncertain(error: unknown) {
  if (error && !(error instanceof CheckoutError)) return true;
  return (
    error instanceof CheckoutError &&
    !['POLICY_UNAVAILABLE', 'GUEST_PROOF_REQUIRED'].includes(error.problem.code) &&
    (['network', 'timeout', 'protocol', 'cancelled'].includes(error.problem.category) ||
      (error.problem.status ?? 0) >= 500 ||
      [
        'LEASE_UNAVAILABLE',
        'RECONCILIATION_REQUIRED',
        'GUEST_SCOPE_CHANGED',
        'COMMAND_IN_PROGRESS',
      ].includes(error.problem.code))
  );
}
export function checkoutMessage(error: unknown) {
  if (!(error instanceof CheckoutError))
    return 'Access changed or the checkout could not be checked. Refresh its private receipt before another action.';
  const code = error.problem.code;
  if (code === 'INVALID_CHECKOUT_DESTINATION')
    return 'The payment provider destination could not be verified. Refresh this private receipt and try continuing the same checkout.';
  if (code === 'GUEST_PROOF_REQUIRED')
    return 'Private receipt access was initialized in this browser. Continue the same reviewed contribution to prepare its checkout.';
  if (checkoutUncertain(error))
    return 'The result is unconfirmed. Keep this page open. Retry only this same request, or refresh its known private receipt; do not start a replacement payment.';
  if (['INVALID_AMOUNT', 'INVALID_CHECKOUT_INPUT'].includes(code))
    return 'Enter an exact positive amount with at most two decimal places and choose an available method. The server checks its contribution limits.';
  if (code === 'RECEIVING_UNAVAILABLE')
    return 'This payment method cannot currently receive the contribution. Refresh and check again; availability can change.';
  if (code === 'POLICY_UNAVAILABLE') return 'Payment creation is not enabled in this environment.';
  if (code === 'FUNDING_CLOSED') return 'The server has closed new funding for this challenge.';
  if (['STALE_VERSION', 'CONFLICT', 'SOURCE_UNAVAILABLE', 'ACCOUNT_RESTRICTED'].includes(code))
    return 'The challenge, terms or access changed. Refresh and review before another action.';
  if (error.problem.status === 401 || error.problem.status === 403 || error.problem.status === 404)
    return 'Private browser access is unavailable. A checkout reference alone cannot restore access.';
  return 'This action could not be confirmed. Check the private receipt before another action.';
}
function context(receipt: Receipt): Context {
  if (receipt.amount.amountMinor === null) reject('INVALID_CHECKOUT_INPUT');
  return Object.freeze({
    id: receipt.id,
    publicId: receipt.publicChallengeId,
    terms: receipt.termsVersion,
    provider: receipt.paymentProvider,
    amount: receipt.amount.amountMinor,
    currency: receipt.amount.currency,
  });
}
export function createCheckoutCommands({
  request,
  active,
  navigate = (url) => window.location.assign(url),
  revision = () => 0,
}: {
  request: ReturnType<typeof createJsonClient>;
  active: () => void;
  navigate?: (url: string) => void;
  revision?: () => number;
}) {
  const attempts = new WeakSet<CheckoutAttempt | CaptureAttempt>(),
    destinations = new WeakMap<Handoff, { url: string; revision: number }>();
  let commanding = false;
  const send = async (
    path: string,
    body: unknown,
    key: string | undefined,
    expected: Context,
    success: readonly (200 | 201 | 202)[] = [200, 202],
  ): Promise<{
    receipt: Receipt;
    action: ReturnType<typeof CheckoutResponseSchema.parse>['data']['nextAction'];
  }> => {
    active();
    const started = revision();
    if (commanding) reject('COMMAND_IN_PROGRESS', 'authority');
    commanding = true;
    try {
      const result = await request({
        path,
        method: 'POST',
        body,
        idempotencyKey: key,
        schema: CheckoutResponseSchema,
        success,
      });
      active();
      if (revision() !== started) reject('GUEST_SCOPE_CHANGED', 'authority');
      if (result.kind !== 'data' && result.kind !== 'pending')
        throw new CheckoutError(
          result.kind === 'error' ? result : failure('protocol', 'UNEXPECTED_CHECKOUT_RESPONSE'),
        );
      const frame = result.data,
        value = frame.data;
      if (result.status === 202 && value.nextAction !== null)
        reject('UNEXPECTED_CHECKOUT_RESPONSE', 'protocol');
      if (
        (expected.id && value.id !== expected.id) ||
        value.publicChallengeId !== expected.publicId ||
        value.termsVersion !== expected.terms ||
        value.paymentProvider !== expected.provider ||
        value.amount.amountMinor !== expected.amount ||
        value.amount.currency !== expected.currency ||
        value.darveFee.currency !== expected.currency
      )
        reject('CHECKOUT_CONTEXT_MISMATCH', 'protocol');
      let view: ReturnType<typeof checkoutConsumerView>;
      try {
        view = checkoutConsumerView(frame, {
          publicChallengeId: expected.publicId,
          termsVersion: expected.terms,
          paymentProvider: expected.provider,
        });
      } catch {
        return reject('CHECKOUT_CONTEXT_MISMATCH', 'protocol');
      }
      const { nextAction, ...receipt } = view;
      return { receipt: { ...receipt, createdAt: value.createdAt }, action: nextAction };
    } finally {
      commanding = false;
    }
  };
  return {
    prepare(value: PublicChallengeDto, provider: Provider, decimal: string): CheckoutAttempt {
      active();
      if (
        value.contentAvailability !== 'available' ||
        !value.checkoutAvailability.available ||
        !value.availablePaymentProviders.some(
          (row) => row.provider === provider && row.availability.available,
        )
      )
        reject('METHOD_UNAVAILABLE');
      let amount: string;
      try {
        amount = contributionAmountMinor(decimal, value.terms.goal.currency);
        PaymentProviderSchema.parse(provider);
      } catch {
        return reject('INVALID_AMOUNT');
      }
      const parsed = CheckoutInputSchema.safeParse({
        termsVersion: value.terms.version,
        paymentProvider: provider,
        amountMinor: amount,
        ...(value.fundingWindow
          ? {
              fundingWindow: {
                version: value.fundingWindow.version,
                revision: value.fundingWindow.revision,
                policyVersion: value.fundingWindow.policyVersion,
              },
            }
          : {}),
      });
      if (!parsed.success) reject('INVALID_CHECKOUT_INPUT');
      if (parsed.data.fundingWindow) Object.freeze(parsed.data.fundingWindow);
      const attempt: CheckoutAttempt = Object.freeze({
        type: 'create',
        key: CheckoutKeySchema.parse(crypto.randomUUID()),
        context: Object.freeze({
          publicId: value.publicId,
          terms: value.terms.version,
          provider,
          amount,
          currency: value.terms.goal.currency,
        }),
        body: Object.freeze(parsed.data),
      });
      attempts.add(attempt);
      return attempt;
    },
    async create(attempt: CheckoutAttempt) {
      active();
      if (!attempts.has(attempt) || attempt.type !== 'create') reject('INVALID_CHECKOUT_INPUT');
      return (
        await send(
          '/api/public/challenges/' + attempt.context.publicId + '/checkouts',
          attempt.body,
          attempt.key,
          attempt.context,
          [200, 201, 202],
        )
      ).receipt;
    },
    prepareCapture(receipt: Receipt): CaptureAttempt {
      active();
      if (
        receipt.paymentProvider !== 'paypal' ||
        receipt.paymentStatus !== 'unconfirmed' ||
        receipt.state !== 'awaiting'
      )
        reject('INVALID_CHECKOUT_INPUT');
      const attempt: CaptureAttempt = Object.freeze({
        type: 'capture',
        key: CheckoutKeySchema.parse(crypto.randomUUID()),
        context: context(receipt),
        body: Object.freeze(CheckoutCompleteInputSchema.parse({})),
      });
      attempts.add(attempt);
      return attempt;
    },
    async capture(attempt: CaptureAttempt) {
      active();
      if (!attempts.has(attempt) || attempt.type !== 'capture') reject('INVALID_CHECKOUT_INPUT');
      return (
        await send(
          '/api/checkouts/' + attempt.context.id + '/complete',
          attempt.body,
          attempt.key,
          attempt.context,
        )
      ).receipt;
    },
    async resume(receipt: Receipt): Promise<Handoff> {
      active();
      const result = await send(
        '/api/checkouts/' + receipt.id + '/resume',
        {},
        undefined,
        context(receipt),
      );
      const handoff = Object.freeze({ receipt: result.receipt, available: !!result.action });
      const action = result.action;
      if (action) {
        const target = action.url ? new URL(action.url) : null;
        if (target) {
          if (target.protocol !== 'https:' || target.username || target.password || target.port)
            reject('INVALID_CHECKOUT_DESTINATION', 'protocol');
          if (action.type === 'redirect') {
            if (
              receipt.paymentProvider !== 'stripe' ||
              target.hostname !== 'checkout.stripe.com' ||
              !/^\/c\/pay\/cs_[A-Za-z0-9_]+$/.test(target.pathname)
            )
              reject('INVALID_CHECKOUT_DESTINATION', 'protocol');
          } else if (
            receipt.paymentProvider !== 'paypal' ||
            target.hash ||
            target.hostname !== 'www.sandbox.paypal.com' ||
            target.pathname !== '/checkoutnow' ||
            target.searchParams.getAll('token').length !== 1 ||
            target.searchParams.get('token') !== action.orderId ||
            [...target.searchParams.keys()].some((key) => key !== 'token')
          )
            reject('INVALID_CHECKOUT_DESTINATION', 'protocol');
          destinations.set(handoff, { url: target.href, revision: revision() });
        }
      }
      return destinations.has(handoff)
        ? handoff
        : Object.freeze({ receipt: result.receipt, available: false });
    },
    follow(handoff: Handoff) {
      active();
      const destination = destinations.get(handoff);
      if (!destination || destination.revision !== revision())
        reject('INVALID_CHECKOUT_DESTINATION');
      destinations.delete(handoff);
      navigate(destination.url);
    },
  };
}
