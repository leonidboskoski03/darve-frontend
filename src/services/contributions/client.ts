import {
  PublicChallengeParamsSchema,
  PublicChallengeResponseSchema,
  CheckoutResponseSchema,
  checkoutConsumerView,
  consumerMoney,
  type PublicChallengeDto,
} from '@/services/contracts/index';
import { createJsonClient, failure, type ApiFailure } from '@/services/api/index';
import { createAuthorityScope, createQueryClient } from '@/services/server-state/index';
import { validReceiptId } from './navigation';

export type { PublicChallengeDto };
export type PublicRead = ReturnType<typeof PublicChallengeResponseSchema.parse>;
export type Receipt = Omit<ReturnType<typeof checkoutConsumerView>, 'nextAction'> & {
  createdAt: string;
};
export class ContributionError extends Error {
  constructor(readonly problem: ApiFailure) {
    super('Contribution information could not be confirmed.');
  }
}
const invalid = (): never => {
  throw new ContributionError(failure('configuration', 'INVALID_CONTRIBUTION_ID'));
};
const mismatch = (): never => {
  throw new ContributionError(failure('protocol', 'CONTRIBUTION_CONTEXT_MISMATCH'));
};
export const contributionMoney = (value: string | null, currency: string) => {
  const money = consumerMoney(value, currency);
  return money.decimal === null ? 'Unavailable' : money.decimal + ' ' + money.currency;
};
export function fundingPercent(value: PublicChallengeDto) {
  const goal = BigInt(value.terms.goal.amountMinor);
  if (goal === 0n) return 0;
  const percent = (BigInt(value.funding.eligibleGross) * 100n) / goal;
  return Number(percent > 100n ? 100n : percent);
}
export function contributionMessage(error: unknown, audience: 'public' | 'receipt' = 'receipt') {
  if (!(error instanceof ContributionError))
    return 'This information could not be read. Try refreshing.';
  const { code, status, category } = error.problem;
  if (code === 'INVALID_CONTRIBUTION_ID')
    return 'Check the challenge or receipt reference and try again.';
  if (status === 401 || status === 403 || status === 404)
    return audience === 'public'
      ? 'This challenge is unavailable. Check its public link or refresh to check again.'
      : 'This information is unavailable in this browser. A receipt needs the original private browser cookie; its reference alone does not grant access.';
  if (category === 'authority') return 'Receipt access changed. Refresh this page to check again.';
  if (status === 429) return 'Too many requests. Wait before refreshing.';
  return 'The current status could not be confirmed. Refresh to check again; no payment action was sent.';
}
/** Public GETs omit cookies. Private GETs have their own lifetime/cache and never issue money commands. */
export function createContributionRuntime(config: {
  origin: string;
  fetcher?: typeof fetch;
  watch?: boolean;
}) {
  const scope = createAuthorityScope('guest'),
    publicQueries = createQueryClient();
  const publicRequest = createJsonClient({
    origin: config.origin,
    audience: 'public',
    lifetime: scope.signal,
    fetcher: config.fetcher,
  });
  const privateRequest = createJsonClient({
    origin: config.origin,
    audience: 'guest',
    lifetime: scope.signal,
    fetcher: config.fetcher,
  });
  let snapshot = {
    visible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
    revision: 0,
  };
  const listeners = new Set<() => void>();
  const active = () => {
    if (scope.signal.aborted)
      throw new ContributionError(failure('authority', 'GUEST_SCOPE_CLOSED'));
  };
  const resetPrivate = (visible: boolean) => {
    if (scope.signal.aborted) return;
    snapshot = { visible, revision: snapshot.revision + 1 };
    void scope.queryClient.cancelQueries();
    scope.queryClient.clear();
    for (const listener of listeners) listener();
  };
  const visibility = () => resetPrivate(document.visibilityState !== 'hidden');
  const hide = () => resetPrivate(false);
  if (config.watch !== false) {
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', visibility);
    window.addEventListener('focus', visibility);
  }
  return {
    scope,
    publicQueries,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refreshPrivate: () => resetPrivate(true),
    async challenge(publicId: string, signal: AbortSignal): Promise<PublicRead> {
      active();
      if (!PublicChallengeParamsSchema.safeParse({ publicId }).success) invalid();
      const result = await publicRequest({
        path: '/api/public/challenges/' + publicId,
        signal,
        schema: PublicChallengeResponseSchema,
        success: [200],
      });
      active();
      if (result.kind !== 'data')
        throw new ContributionError(
          result.kind === 'error' ? result : failure('protocol', 'UNEXPECTED_PUBLIC_RESPONSE'),
        );
      const value = result.data;
      if (
        value.data.publicId !== publicId ||
        new Set(value.data.availablePaymentProviders.map((row) => row.provider)).size !== 2
      )
        mismatch();
      return value;
    },
    async receipt(id: string, signal: AbortSignal): Promise<Receipt> {
      active();
      if (!validReceiptId(id)) invalid();
      const revision = snapshot.revision;
      if (!snapshot.visible)
        throw new ContributionError(failure('authority', 'GUEST_SCOPE_HIDDEN'));
      const result = await privateRequest({
        path: '/api/checkouts/' + id,
        signal,
        schema: CheckoutResponseSchema,
        success: [200],
      });
      active();
      if (revision !== snapshot.revision || !snapshot.visible)
        throw new ContributionError(failure('authority', 'GUEST_SCOPE_CHANGED'));
      if (result.kind !== 'data')
        throw new ContributionError(
          result.kind === 'error' ? result : failure('protocol', 'UNEXPECTED_RECEIPT_RESPONSE'),
        );
      const value = result.data.data;
      if (value.id !== id || value.amount.currency !== value.darveFee.currency) mismatch();
      const { nextAction: unusedAction, ...receipt } = checkoutConsumerView(result.data, {
        publicChallengeId: value.publicChallengeId,
        termsVersion: value.termsVersion,
        paymentProvider: value.paymentProvider,
      });
      void unusedAction; // Status reads never expose or follow provider/approval URLs.
      return { ...receipt, createdAt: value.createdAt };
    },
    dispose() {
      if (config.watch !== false) {
        document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener('pagehide', hide);
        window.removeEventListener('pageshow', visibility);
        window.removeEventListener('focus', visibility);
      }
      scope.dispose();
      publicQueries.clear();
      listeners.clear();
    },
  };
}
export type ContributionRuntime = ReturnType<typeof createContributionRuntime>;

/** StrictMode restart always creates a fresh guest scope, with no reused private cache. */
export function createContributionController(origin: string) {
  let runtime: ContributionRuntime | null = null;
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => runtime,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (runtime) return;
      runtime = createContributionRuntime({ origin });
      publish();
    },
    stop() {
      runtime?.dispose();
      runtime = null;
      publish();
    },
  };
}
