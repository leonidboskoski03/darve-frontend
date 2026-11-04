import {
  TemplateRedemptionInputSchema,
  CoinRedemptionDataSchema,
  coinEnvelope,
} from '@/services/contracts/index';
import {
  createCoinReadClient,
  type CoinReadClient,
  type CoinAccountResponse,
} from '@/services/coins/index';
import { failure, type ApiFailure } from '@/services/api/index';
import type { CreatorSession } from '@/services/creator-session/index';
import type { AuthorityScope } from '@/services/server-state/index';

export type TemplateItem = Awaited<
  ReturnType<CoinReadClient['catalogue']>
>['data']['templates'][number];
export type TemplateResources = {
  account: CoinAccountResponse;
  catalogue: Awaited<ReturnType<CoinReadClient['catalogue']>>;
  entitlements: Awaited<ReturnType<CoinReadClient['entitlements']>>;
};
export type RedemptionAttempt = Readonly<{
  key: string;
  name: string;
  assetVersion: number;
  templateId: string;
  input: Readonly<ReturnType<typeof TemplateRedemptionInputSchema.parse>>;
}>;
type RedemptionData = ReturnType<typeof CoinRedemptionDataSchema.parse>;
export type RedemptionState = Readonly<{
  phase: 'idle' | 'review' | 'sending' | 'uncertain' | 'pending' | 'rejected' | 'confirmed';
  attempt: RedemptionAttempt | null;
  receipt: RedemptionData | null;
  error: ApiFailure | null;
  retryAt: number;
}>;
const idle: RedemptionState = {
  phase: 'idle',
  attempt: null,
  receipt: null,
  error: null,
  retryAt: 0,
};
const responseSchema = coinEnvelope(CoinRedemptionDataSchema);
export class TemplateError extends Error {
  constructor(readonly problem: ApiFailure) {
    super('Template information could not be verified.');
    this.name = 'TemplateError';
  }
}
export function redemptionBlock(resources: TemplateResources, item: TemplateItem): string | null {
  if (
    item.owned ||
    item.ownershipState !== 'not_owned' ||
    resources.entitlements.data.templates.some((row) => row.id === item.id)
  )
    return 'Ownership is already recorded.';
  if (!item.available) return 'This template is currently unavailable.';
  if (item.priceRevision === null || item.amount === null)
    return 'A current price is not configured.';
  if (!resources.account.data.redemptionAllowed || resources.account.data.spendableBalance === null)
    return 'Available coins or redemption permission are not confirmed.';
  if (BigInt(resources.account.data.spendableBalance) < BigInt(item.amount))
    return 'You do not have enough available coins.';
  return null;
}
function buildClient(session: CreatorSession) {
  const scope = session.getSnapshot().scope,
    readers = createCoinReadClient(session),
    listeners = new Set<() => void>();
  let state: RedemptionState = idle;
  const active = () => {
    if (
      scope.signal.aborted ||
      session.getSnapshot().scope !== scope ||
      session.getSnapshot().phase !== 'authenticated'
    )
      throw new TemplateError(failure('authority', 'AUTHORITY_CHANGED'));
  };
  const publish = (next: RedemptionState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  scope.onDispose(() => {
    state = idle;
    clients.delete(scope);
    for (const listener of listeners) listener();
    listeners.clear();
  });
  function invalid(): never {
    throw new TemplateError(failure('configuration', 'INVALID_REDEMPTION_REVIEW'));
  }
  return {
    scope,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    async resources(signal: AbortSignal): Promise<TemplateResources> {
      active();
      const [account, catalogue, entitlements] = await Promise.all([
        readers.account(signal),
        readers.catalogue(signal),
        readers.entitlements(signal),
      ]);
      active();
      return { account, catalogue, entitlements };
    },
    prepare(resources: TemplateResources, id: string) {
      active();
      if (state.attempt || state.phase === 'sending') invalid();
      const item = resources.catalogue.data.templates.find((row) => row.id === id);
      if (!item || redemptionBlock(resources, item)) invalid();
      const parsed = TemplateRedemptionInputSchema.safeParse({
        expectedAccountRevision: resources.account.data.revision,
        priceRevision: item.priceRevision,
        amount: item.amount,
        confirmation: { templateId: id },
      });
      if (!parsed.success) invalid();
      const input = Object.freeze({
        ...parsed.data,
        confirmation: Object.freeze({ templateId: id }),
      });
      publish({
        phase: 'review',
        attempt: Object.freeze({
          key: crypto.randomUUID(),
          name: item.displayName,
          assetVersion: item.assetVersion,
          templateId: id,
          input,
        }),
        receipt: null,
        error: null,
        retryAt: 0,
      });
    },
    cancelReview() {
      active();
      if (state.phase === 'review') publish(idle);
    },
    async redeem(confirmed: boolean) {
      active();
      if (
        !confirmed ||
        !state.attempt ||
        !['review', 'uncertain'].includes(state.phase) ||
        Date.now() < state.retryAt
      )
        invalid();
      const attempt = state.attempt;
      void scope.queryClient.cancelQueries({ queryKey: scope.key(['templates']) });
      publish({ ...state, phase: 'sending', error: null });
      const result = await session
        .request({
          path: '/api/templates/' + attempt.templateId + '/redemptions',
          method: 'POST',
          body: attempt.input,
          idempotencyKey: attempt.key,
          schema: responseSchema,
          success: [200],
        })
        .catch(() => failure('network', 'REDEMPTION_RESULT_UNKNOWN'));
      if (scope.signal.aborted) return;
      active();
      let problem: ApiFailure;
      if (result.kind === 'data') {
        const data = result.data.data;
        if (
          data.templateId === attempt.templateId &&
          (data.state === 'already_owned'
            ? data.charged === '0'
            : data.charged === attempt.input.amount &&
              Boolean(data.transactionId) &&
              Boolean(data.redemptionId))
        ) {
          publish({ ...state, phase: 'pending', receipt: data, error: null, retryAt: 0 });
          void scope.queryClient.invalidateQueries({ queryKey: scope.key(['coins']) });
          return;
        }
        problem = failure('protocol', 'REDEMPTION_RESPONSE_MISMATCH');
      } else
        problem =
          result.kind === 'error' ? result : failure('protocol', 'UNEXPECTED_REDEMPTION_RESPONSE');
      const definite =
        problem.category === 'http' &&
        problem.status !== null &&
        problem.status >= 400 &&
        problem.status < 500 &&
        problem.status !== 429;
      publish({
        phase: definite ? 'rejected' : 'uncertain',
        attempt: definite ? null : attempt,
        receipt: null,
        error: problem,
        retryAt: Date.now() + (problem.retryAfterSeconds ?? 0) * 1000,
      });
      void scope.queryClient.invalidateQueries({ queryKey: scope.key(['coins']) });
    },
    reconcile(resources: TemplateResources) {
      active();
      if (!state.attempt || !['pending', 'uncertain'].includes(state.phase)) return;
      const item = resources.entitlements.data.templates.find(
        (row) => row.id === state.attempt!.templateId,
      );
      if (!item?.owned) return;
      if (
        item.ownershipState === 'owned' &&
        !['synchronization_pending', 'unavailable'].includes(resources.account.data.state)
      )
        publish({
          phase: 'confirmed',
          attempt: null,
          receipt: state.receipt,
          error: null,
          retryAt: 0,
        });
      else if (state.phase === 'uncertain') publish({ ...state, phase: 'pending', error: null });
    },
  };
}
export type TemplateClient = ReturnType<typeof buildClient>;
const clients = new WeakMap<AuthorityScope, TemplateClient>();
/** One transient command holder per creator authority; Query alone owns server snapshots. */
export function createTemplateClient(session: CreatorSession): TemplateClient {
  const scope = session.getSnapshot().scope;
  let client = clients.get(scope);
  if (!client) {
    client = buildClient(session);
    clients.set(scope, client);
  }
  return client;
}
