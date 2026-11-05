import {
  CoinConfigurationInputSchema,
  CoinAdjustmentInputSchema,
  TemplatePriceInputSchema,
  TemplateIdSchema,
  CoinCommandResponseSchema,
  CoinConfigurationViewSchema,
  CoinAccountViewSchema,
  CoinConfigurationItemSchema,
  CoinPriceItemSchema,
  CoinPriceDataSchema,
  CoinCatalogueDataSchema,
  CoinLedgerItemSchema,
  CoinHistoryQuerySchema,
  SupportContextSchema,
  coinEnvelope,
  coinPage,
} from '@/services/contracts/index';
import { failure, type ApiFailure, type JsonRequest } from '@/services/api/index';
import type { StaffAccess } from '@/services/staff-access/index';
import type { AuthorityScope } from '@/services/server-state/index';

export type CoinConfiguration = ReturnType<typeof CoinConfigurationViewSchema.parse>;
export type StaffCoinAccount = ReturnType<typeof CoinAccountViewSchema.parse>;
export type StaffCoinTemplate = ReturnType<
  typeof CoinCatalogueDataSchema.parse
>['templates'][number];
export type CoinCommandKind = 'configure' | 'adjust' | 'price';
export type StaffCoinAttempt = Readonly<{
  kind: CoinCommandKind;
  target: string;
  key: string;
  summary: string;
  body: Readonly<Record<string, unknown>>;
}>;
export type StaffCoinCommandState = Readonly<{
  phase: 'idle' | 'review' | 'sending' | 'uncertain' | 'recorded' | 'rejected';
  attempt: StaffCoinAttempt | null;
  error: ApiFailure | null;
  outcome: 'configured' | 'synchronization_pending' | 'priced' | null;
}>;
const idle: StaffCoinCommandState = { phase: 'idle', attempt: null, error: null, outcome: null };
export class StaffCoinError extends Error {
  constructor(readonly problem: ApiFailure) {
    super('Staff coin information could not be verified.');
  }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const schemas = {
  configure: CoinConfigurationInputSchema,
  adjust: CoinAdjustmentInputSchema,
  price: TemplatePriceInputSchema,
};
const permissions = { configure: 'coins.configure', adjust: 'coins.adjust', price: 'coins.price' };
function build(access: StaffAccess) {
  const scope = access.getSnapshot().scope,
    listeners = new Set<() => void>();
  let state = idle,
    retryAt = 0;
  const publish = (next: StaffCoinCommandState) => {
    state = next;
    listeners.forEach((fn) => fn());
  };
  const reject: (code?: string) => never = (code = 'INVALID_STAFF_COIN_INPUT') => {
    throw new StaffCoinError(failure('configuration', code));
  };
  const active = () => {
    const current = access.getSnapshot();
    if (scope.signal.aborted || current.scope !== scope || current.phase !== 'authenticated')
      throw new StaffCoinError(failure('authority', 'AUTHORITY_CHANGED'));
  };
  const permit = (permission = 'coins.read') => {
    active();
    const current = access.getSnapshot();
    if (current.role !== 'OWNER_ADMIN' || !current.permissions.includes(permission))
      throw new StaffCoinError(failure('authority', 'STAFF_PERMISSION_REQUIRED', 403));
  };
  const uuid = (value: string) => {
    if (!SupportContextSchema.safeParse({ kind: 'challenge', id: value }).success) reject();
    return value;
  };
  const template = (value: string) => {
    const parsed = TemplateIdSchema.safeParse(value);
    return parsed.success ? parsed.data : reject();
  };
  const mismatch = (): never => {
    throw new StaffCoinError(failure('protocol', 'STAFF_COIN_RESOURCE_MISMATCH'));
  };
  const request = async <T>(input: JsonRequest<T>) => {
    permit();
    if (Date.now() < retryAt)
      throw new StaffCoinError({
        ...failure('http', 'RATE_LIMITED', 429),
        retryAfterSeconds: Math.ceil((retryAt - Date.now()) / 1000),
      });
    const result = await access.request(input);
    active();
    if (result.kind === 'data') return result.data;
    const problem =
      result.kind === 'error' ? result : failure('protocol', 'INVALID_STAFF_COIN_RESPONSE');
    if ([429, 503].includes(problem.status ?? 0) && problem.retryAfterSeconds !== null)
      retryAt = Date.now() + Math.max(1, problem.retryAfterSeconds) * 1000;
    throw new StaffCoinError(problem);
  };
  const page = async <T extends { revision: number }>(
    path: string,
    item: Parameters<typeof coinPage>[0],
    cursor: string | null,
    signal: AbortSignal,
  ) => {
    const parsed = CoinHistoryQuerySchema.safeParse(cursor === null ? {} : { cursor });
    if (!parsed.success || cursor === '') reject();
    const value = await request({
      path: path + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
      schema: coinPage(item),
      success: [200],
      signal,
    });
    const data = value.data as { items: T[]; nextCursor: string | null };
    if (
      (cursor !== null && data.nextCursor === cursor) ||
      data.items.some((row, index) => index > 0 && row.revision >= data.items[index - 1]!.revision)
    )
      mismatch();
    return data;
  };
  scope.onDispose(() => {
    state = idle;
    clients.delete(scope);
    listeners.forEach((fn) => fn());
    listeners.clear();
  });
  return {
    access,
    scope,
    subscribe(this: void, fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getSnapshot: () => state,
    retryDelay: () => Math.max(0, retryAt - Date.now()),
    async configuration(signal: AbortSignal) {
      const value = await request({
        path: '/admin/v1/coins/configuration',
        schema: CoinConfigurationViewSchema,
        success: [200],
        signal,
      });
      if (
        (value.configurations[0]?.revision ?? 0) !== value.revision ||
        value.configurations.some(
          (row, index) =>
            row.revision > value.revision ||
            (index > 0 && row.revision >= value.configurations[index - 1]!.revision),
        )
      )
        mismatch();
      return value;
    },
    async account(id: string, signal: AbortSignal) {
      const value = await request({
        path: '/admin/v1/coins/accounts/' + uuid(id),
        schema: CoinAccountViewSchema,
        success: [200],
        signal,
      });
      if (
        value.ownerId !== id ||
        new Set(value.claims.map((row) => row.mission)).size !== value.claims.length ||
        value.ledger.some(
          (row, index) =>
            row.revision > value.revision ||
            (index > 0 && row.revision >= value.ledger[index - 1]!.revision),
        )
      )
        mismatch();
      return value;
    },
    async catalogue(signal: AbortSignal) {
      const value = (
        await request({
          path: '/admin/v1/coins/templates',
          schema: coinEnvelope(CoinCatalogueDataSchema),
          success: [200],
          signal,
        })
      ).data;
      if (
        new Set(value.templates.map((row) => row.id)).size !== value.templates.length ||
        value.templates.some((row) => (row.amount === null) !== (row.priceRevision === null))
      )
        mismatch();
      return value.templates;
    },
    configurationHistory: (cursor: string | null, signal: AbortSignal) =>
      page<ReturnType<typeof CoinConfigurationItemSchema.parse>>(
        '/admin/v1/coins/configuration-history',
        CoinConfigurationItemSchema,
        cursor,
        signal,
      ),
    ledger: (id: string, cursor: string | null, signal: AbortSignal) =>
      page<ReturnType<typeof CoinLedgerItemSchema.parse>>(
        '/admin/v1/coins/accounts/' + uuid(id) + '/ledger',
        CoinLedgerItemSchema,
        cursor,
        signal,
      ),
    prices: (id: string, cursor: string | null, signal: AbortSignal) =>
      page<ReturnType<typeof CoinPriceItemSchema.parse>>(
        '/admin/v1/coins/templates/' + template(id) + '/prices',
        CoinPriceItemSchema,
        cursor,
        signal,
      ),
    prepare(kind: CoinCommandKind, target: string, raw: unknown, summary: string) {
      permit(permissions[kind]);
      if (state.attempt) reject('STAFF_COIN_COMMAND_HELD');
      const parsed = schemas[kind].safeParse(raw);
      if (!parsed.success) reject();
      const body = parsed.data;
      if (
        (kind === 'configure' &&
          (!('programId' in body.confirmation) || body.confirmation.programId !== uuid(target))) ||
        (kind === 'adjust' &&
          (!('ownerId' in body.confirmation) || body.confirmation.ownerId !== uuid(target))) ||
        (kind === 'price' &&
          (!('templateId' in body.confirmation) ||
            body.confirmation.templateId !== template(target)))
      )
        reject();
      publish({
        phase: 'review',
        attempt: freeze({
          kind,
          target,
          key: crypto.randomUUID(),
          body: structuredClone(body),
          summary,
        }),
        error: null,
        outcome: null,
      });
    },
    cancel() {
      active();
      if (state.phase === 'review') publish(idle);
    },
    clear() {
      active();
      if (!state.attempt) publish(idle);
    },
    async execute(confirmed: boolean) {
      active();
      if (!confirmed || !state.attempt || !['review', 'uncertain'].includes(state.phase)) reject();
      const attempt = state.attempt;
      permit(permissions[attempt.kind]);
      publish({ ...state, phase: 'sending', error: null });
      try {
        const path =
          attempt.kind === 'configure'
            ? '/admin/v1/coins/configuration-revisions'
            : attempt.kind === 'adjust'
              ? '/admin/v1/coins/accounts/' + attempt.target + '/adjustments'
              : '/admin/v1/coins/templates/' + attempt.target + '/prices';
        const input = {
          path,
          method: 'POST' as const,
          body: attempt.body,
          idempotencyKey: attempt.key,
          success: [200] as const,
        };
        const value =
          attempt.kind === 'price'
            ? (await request({ ...input, schema: coinEnvelope(CoinPriceDataSchema) })).data
            : (await request({ ...input, schema: CoinCommandResponseSchema })).data;
        if (
          value.revision !== Number(attempt.body.expectedRevision) + 1 ||
          ('templateId' in value &&
            (value.templateId !== attempt.target || value.amount !== attempt.body.amount))
        )
          mismatch();
        if (
          'state' in value &&
          value.state !== (attempt.kind === 'adjust' ? 'synchronization_pending' : 'configured')
        )
          mismatch();
        publish({
          phase: 'recorded',
          attempt: null,
          error: null,
          outcome: 'state' in value ? value.state : 'priced',
        });
      } catch (error) {
        if (scope.signal.aborted) return;
        active();
        const problem =
          error instanceof StaffCoinError
            ? error.problem
            : failure('network', 'STAFF_COIN_RESULT_UNKNOWN');
        const uncertain =
          ['network', 'timeout', 'protocol'].includes(problem.category) ||
          [429, 503].includes(problem.status ?? 0) ||
          (problem.status ?? 0) >= 500;
        publish({
          phase: uncertain ? 'uncertain' : 'rejected',
          attempt: uncertain ? attempt : null,
          error: problem,
          outcome: null,
        });
      }
    },
  };
}
export type StaffCoinClient = ReturnType<typeof build>;
const clients = new WeakMap<AuthorityScope, StaffCoinClient>();
export function createStaffCoinClient(access: StaffAccess) {
  const scope = access.getSnapshot().scope;
  let client = clients.get(scope);
  if (!client) {
    client = build(access);
    clients.set(scope, client);
  }
  return client;
}
