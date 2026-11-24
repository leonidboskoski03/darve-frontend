import {
  BotAdminCommandSchema,
  BotAdminResponseSchema,
  BotAccountsResponseSchema,
} from '@/services/contracts/index';
import { failure, type ApiFailure, type JsonRequest } from '@/services/api/index';
import type { StaffAccess } from '@/services/staff-access/index';
import type { AuthorityScope } from '@/services/server-state/index';
export type BotAccount = ReturnType<
  typeof BotAccountsResponseSchema.parse
>['data']['items'][number];
type Attempt = Readonly<{
  id: string;
  action: 'refresh' | 'revoke';
  key: string;
  body: ReturnType<typeof BotAdminCommandSchema.parse>;
  summary: string;
}>;
type State = {
  phase: 'idle' | 'review' | 'sending' | 'uncertain' | 'recorded' | 'rejected';
  attempt: Attempt | null;
  error: ApiFailure | null;
};
const idle: State = { phase: 'idle', attempt: null, error: null };
const clients = new WeakMap<AuthorityScope, ReturnType<typeof build>>();
export class StaffBotError extends Error {
  constructor(readonly problem: ApiFailure) {
    super('DarveBot account could not be verified');
  }
}
function build(access: StaffAccess) {
  const scope = access.getSnapshot().scope;
  let state = idle;
  const listeners = new Set<() => void>();
  let retryAt = 0;
  const active = () => {
    const current = access.getSnapshot();
    if (current.scope !== scope || scope.signal.aborted || current.phase !== 'authenticated')
      throw new StaffBotError(failure('authority', 'AUTHORITY_CHANGED'));
  };
  const permit = (permission: string) => {
    active();
    const current = access.getSnapshot();
    if (current.role !== 'OWNER_ADMIN' || !current.permissions.includes(permission))
      throw new StaffBotError(failure('authority', 'STAFF_PERMISSION_REQUIRED', 403));
  };
  const publish = (next: State) => {
    state = next;
    listeners.forEach((fn) => fn());
  };
  const request = async <T>(input: JsonRequest<T>) => {
    active();
    if (Date.now() < retryAt) throw new StaffBotError(failure('http', 'RATE_LIMITED', 429));
    const result = await access.request(input);
    active();
    if (result.kind === 'data') return result.data;
    const problem = result.kind === 'error' ? result : failure('protocol', 'BOT_RESULT_UNKNOWN');
    if ([429, 503].includes(problem.status ?? 0))
      retryAt = Date.now() + Math.max(1, problem.retryAfterSeconds ?? 1) * 1000;
    throw new StaffBotError(problem);
  };
  scope.onDispose(() => {
    state = idle;
    clients.delete(scope);
    listeners.forEach((fn) => fn());
    listeners.clear();
  });
  return {
    scope,
    access,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    async read(signal: AbortSignal) {
      permit('bots.read');
      const { data } = await request({
        path: '/admin/v1/bots',
        signal,
        success: [200],
        schema: BotAccountsResponseSchema,
      });
      if (new Set(data.items.map((item) => item.provider)).size !== 3)
        throw new StaffBotError(failure('protocol', 'BOT_RESOURCE_MISMATCH'));
      return data.items;
    },
    prepare(account: BotAccount, action: 'refresh' | 'revoke', reason: string) {
      permit('bots.write');
      if (state.attempt || !account.authorizationId)
        throw new StaffBotError(failure('authority', 'BOT_COMMAND_HELD'));
      const body = BotAdminCommandSchema.parse({
        expectedRevision: account.revision,
        reason,
        confirmation: { authorizationId: account.authorizationId },
      });
      Object.freeze(body.confirmation);
      Object.freeze(body);
      publish({
        phase: 'review',
        error: null,
        attempt: Object.freeze({
          id: account.authorizationId,
          action,
          key: crypto.randomUUID(),
          body,
          summary: `${action === 'refresh' ? 'Refresh' : 'Revoke'} ${account.provider} ${account.actorKind === 'DARVE_BOT' ? 'DarveBot' : 'test actor'}${account.channelName ? ' (' + account.channelName + ')' : ''}`,
        }),
      });
    },
    cancel() {
      active();
      if (state.phase === 'review') publish(idle);
    },
    async execute(confirmed: boolean) {
      permit('bots.write');
      const attempt = state.attempt;
      if (!confirmed || !attempt || !['review', 'uncertain'].includes(state.phase))
        throw new StaffBotError(failure('authority', 'BOT_REVIEW_REQUIRED'));
      publish({ ...state, phase: 'sending', error: null });
      try {
        const { data } = await request({
          path: `/admin/v1/bots/${attempt.id}/${attempt.action}`,
          method: 'POST',
          body: attempt.body,
          idempotencyKey: attempt.key,
          success: [200],
          schema: BotAdminResponseSchema,
        });
        if (
          data.authorizationId !== attempt.id ||
          data.action !== attempt.action ||
          data.revision !== attempt.body.expectedRevision + (attempt.action === 'revoke' ? 1 : 0)
        )
          throw new StaffBotError(failure('protocol', 'BOT_RESOURCE_MISMATCH'));
        publish({ phase: 'recorded', attempt: null, error: null });
      } catch (error) {
        if (scope.signal.aborted) return;
        active();
        const problem =
          error instanceof StaffBotError ? error.problem : failure('network', 'BOT_RESULT_UNKNOWN');
        const uncertain =
          ['network', 'timeout', 'protocol'].includes(problem.category) ||
          [429, 503].includes(problem.status ?? 0) ||
          (problem.status ?? 0) >= 500;
        publish({
          phase: uncertain ? 'uncertain' : 'rejected',
          attempt: uncertain ? attempt : null,
          error: problem,
        });
      }
    },
  };
}
export function createStaffBotClient(access: StaffAccess) {
  const scope = access.getSnapshot().scope;
  let client = clients.get(scope);
  if (!client) {
    client = build(access);
    clients.set(scope, client);
  }
  return client;
}
export type StaffBotClient = ReturnType<typeof createStaffBotClient>;
