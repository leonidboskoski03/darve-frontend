import { failure, type ApiFailure, type JsonRequest } from '@/services/api/index';
import type { CreatorSession } from '@/services/creator-session/index';
import {
  StripeReceivingResponseSchema,
  StripeOnboardingInputSchema,
  StripeOnboardingResponseSchema,
  StripeReceivingKeySchema,
  StripeReceivingRevokeInputSchema,
  StripeExistingAccountStartResponseSchema,
  PayPalReceivingResponseSchema,
  PayPalOnboardingInputSchema,
  PayPalOnboardingResponseSchema,
  PayPalReceivingKeySchema,
  PayPalReceivingRevokeInputSchema,
} from '@/services/contracts/index';

export type StripeReceiving = ReturnType<typeof StripeReceivingResponseSchema.parse>;
export type PayPalReceiving = ReturnType<typeof PayPalReceivingResponseSchema.parse>;
type SetupInputs = {
  stripe: ReturnType<typeof StripeOnboardingInputSchema.parse>;
  stripeExisting: ReturnType<typeof StripeOnboardingInputSchema.parse>;
  paypal: ReturnType<typeof PayPalOnboardingInputSchema.parse>;
};
type Flow = keyof SetupInputs;
export type ReceivingAttempt<F extends Flow> = Readonly<{
  flow: F;
  key: string;
  input: Readonly<SetupInputs[F]>;
}>;
const base = '/api/payment-accounts/';

export class ReceivingError extends Error {
  constructor(readonly problem: ApiFailure) {
    super('Receiving account state could not be confirmed.');
  }
}

export function receivingUncertain(error: unknown) {
  return (
    error instanceof ReceivingError &&
    (['network', 'timeout', 'protocol'].includes(error.problem.category) ||
      (error.problem.status ?? 0) >= 500)
  );
}

function invalid(): never {
  throw new ReceivingError(failure('configuration', 'INVALID_RECEIVING_INPUT'));
}
function invalidHandoff(): never {
  throw new ReceivingError(failure('protocol', 'INVALID_RECEIVING_HANDOFF'));
}

function verifyDestination(value: string, flow: Flow, apiOrigin: string | undefined) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalidHandoff();
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) invalidHandoff();
  switch (flow) {
    case 'stripe':
      if (!['accounts.stripe.com', 'connect.stripe.com'].includes(url.hostname)) invalidHandoff();
      break;
    case 'stripeExisting':
      if (
        url.hostname !== 'connect.stripe.com' ||
        url.pathname !== '/oauth/authorize' ||
        url.hash ||
        !apiOrigin ||
        url.searchParams.getAll('redirect_uri').length !== 1 ||
        url.searchParams.get('redirect_uri') !== apiOrigin + base + 'stripe/oauth/callback'
      )
        invalidHandoff();
      break;
    case 'paypal':
      if (
        url.hostname !== 'www.sandbox.paypal.com' ||
        url.hash ||
        !/^\/(bizsignup\/partner\/entry|(?:[a-z]{2}\/)?merchantsignup\/partner\/onboardingentry)$/.test(
          url.pathname,
        )
      )
        invalidHandoff();
  }
}

/** Provider URLs are transient handoffs. Keep them out of query caches and browser storage. */
export function createReceivingClient(session: CreatorSession) {
  const scope = session.getSnapshot().scope;
  const attempts = new WeakSet<object>();
  let mutating = false;

  const active = () => {
    const snapshot = session.getSnapshot();
    if (snapshot.scope !== scope || scope.signal.aborted || snapshot.phase !== 'authenticated')
      throw new ReceivingError(failure('authority', 'AUTHORITY_CHANGED'));
  };
  const request = async <T>(input: JsonRequest<T>) => {
    active();
    const result = await session.request(input);
    active();
    if (result.kind === 'error') throw new ReceivingError(result);
    return result;
  };
  const read = async <T>(input: JsonRequest<T>) => {
    const result = await request(input);
    if (result.kind === 'empty') return invalidHandoff();
    return result;
  };
  const mutate = async <T>(action: () => Promise<T>) => {
    active();
    if (mutating)
      throw new ReceivingError(failure('configuration', 'RECEIVING_COMMAND_IN_PROGRESS'));
    mutating = true;
    try {
      return await action();
    } finally {
      mutating = false;
    }
  };
  const prepare = <F extends Flow>(flow: F, input: SetupInputs[F]): ReceivingAttempt<F> => {
    active();
    const key = crypto.randomUUID();
    if (
      !(flow === 'paypal' ? PayPalReceivingKeySchema : StripeReceivingKeySchema).safeParse(key)
        .success
    )
      invalid();
    const attempt = Object.freeze({ flow, key, input: Object.freeze(input) });
    attempts.add(attempt);
    return attempt;
  };
  const command = <T, F extends Flow>(
    flow: F,
    attempt: ReceivingAttempt<F>,
    options: Pick<JsonRequest<T>, 'path' | 'schema' | 'success'>,
  ) => {
    if (attempt.flow !== flow || !attempts.has(attempt)) invalid();
    return read({ ...options, method: 'POST', body: attempt.input, idempotencyKey: attempt.key });
  };

  return {
    scope,
    stripeStatus: async (signal?: AbortSignal) =>
      (
        await read({
          path: base + 'stripe',
          schema: StripeReceivingResponseSchema,
          success: [200],
          signal,
        })
      ).data,
    paypalStatus: async (signal?: AbortSignal) =>
      (
        await read({
          path: base + 'paypal',
          schema: PayPalReceivingResponseSchema,
          success: [200],
          signal,
        })
      ).data,
    prepareStripe(country: string) {
      const result = StripeOnboardingInputSchema.safeParse({ country });
      return result.success ? prepare('stripe', result.data) : invalid();
    },
    prepareStripeExisting(country: string) {
      const result = StripeOnboardingInputSchema.safeParse({ country });
      return result.success ? prepare('stripeExisting', result.data) : invalid();
    },
    preparePayPal(country: string, shareDataConsent: boolean) {
      const result = PayPalOnboardingInputSchema.safeParse({ country, shareDataConsent });
      return result.success ? prepare('paypal', result.data) : invalid();
    },
    onboardStripe: (attempt: ReceivingAttempt<'stripe'>) =>
      mutate(async () => {
        const result = await command('stripe', attempt, {
          path: base + 'stripe/onboarding',
          schema: StripeOnboardingResponseSchema,
          success: [200, 202],
        });
        const { url, expiresAt, status } = result.data.data;
        if (result.kind === 'pending') {
          if (url !== null || expiresAt !== null) invalidHandoff();
          return { kind: 'pending' as const, status };
        }
        if (!url || !expiresAt || Date.parse(expiresAt) <= Date.parse(result.data.serverTime))
          return invalidHandoff();
        verifyDestination(url, 'stripe', session.origin);
        return { kind: 'redirect' as const, url, expiresAt, status };
      }),
    connectExistingStripe: (attempt: ReceivingAttempt<'stripeExisting'>) =>
      mutate(async () => {
        const result = await command('stripeExisting', attempt, {
          path: base + 'stripe/oauth/start',
          schema: StripeExistingAccountStartResponseSchema,
          success: [200, 202],
        });
        const { state, nextAction, expiresAt } = result.data.data;
        if (result.kind === 'pending') {
          if (nextAction || state === 'authorization_required') invalidHandoff();
          return { kind: 'pending' as const, state, expiresAt };
        }
        if (
          state !== 'authorization_required' ||
          !nextAction ||
          !expiresAt ||
          Date.parse(expiresAt) <= Date.now()
        )
          return invalidHandoff();
        verifyDestination(nextAction.url, 'stripeExisting', session.origin);
        return { kind: 'redirect' as const, url: nextAction.url, expiresAt };
      }),
    onboardPayPal: (attempt: ReceivingAttempt<'paypal'>) =>
      mutate(async () => {
        const result = await command('paypal', attempt, {
          path: base + 'paypal/onboarding',
          schema: PayPalOnboardingResponseSchema,
          success: [200],
        });
        const { url, status } = result.data.data;
        if (!url) return { kind: 'status' as const, status };
        verifyDestination(url, 'paypal', session.origin);
        return { kind: 'redirect' as const, url, status };
      }),
    refreshStripe: () =>
      mutate(
        async () =>
          (
            await read({
              path: base + 'stripe/refresh',
              method: 'POST',
              body: {},
              schema: StripeReceivingResponseSchema,
              success: [200],
            })
          ).data,
      ),
    refreshPayPal: () =>
      mutate(
        async () =>
          (
            await read({
              path: base + 'paypal/refresh',
              method: 'POST',
              body: {},
              schema: PayPalReceivingResponseSchema,
              success: [200],
            })
          ).data,
      ),
    revokeStripe: (expectedVersion: number) =>
      mutate(async () => {
        const input = StripeReceivingRevokeInputSchema.safeParse({ expectedVersion });
        if (!input.success) return invalid();
        const result = await request({
          path: base + 'stripe',
          method: 'DELETE',
          body: input.data,
          schema: StripeReceivingResponseSchema,
          success: [204],
        });
        if (result.kind !== 'empty') invalidHandoff();
      }),
    revokePayPal: (expectedVersion: number) =>
      mutate(async () => {
        const input = PayPalReceivingRevokeInputSchema.safeParse({ expectedVersion });
        if (!input.success) return invalid();
        return (
          await read({
            path: base + 'paypal',
            method: 'DELETE',
            body: input.data,
            schema: PayPalReceivingResponseSchema,
            success: [200],
          })
        ).data;
      }),
  };
}
