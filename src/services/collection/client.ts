import {
  BroadcastsQuerySchema,
  BroadcastsResponseSchema,
  StartRoundInputSchema,
  StopRoundInputSchema,
  RoundParamsSchema,
  RoundResponseSchema,
  type StartRoundInput,
  type RoundDto,
} from '@/services/contracts/index';
import { failure, type ApiFailure, type ApiResult, type JsonRequest } from '@/services/api/index';
import { createCreatorAccessClient } from '@/services/creator-access/index';
import type { CreatorSession } from '@/services/creator-session/index';

export type { StartRoundInput, RoundDto };
export type Discovery = ReturnType<typeof BroadcastsResponseSchema.parse>['data'] & {
  serverTime: string;
  receivedAt: number;
};
export type Broadcast = Discovery['items'][number];
export type RoundRead = {
  round: RoundDto;
  serverTime: string;
  receivedAt: number;
  requestedAt: number;
};
export type StartAttempt = Readonly<{
  input: Readonly<StartRoundInput>;
  key: string;
  scopeId: number;
}>;
export class CollectionError extends Error {
  constructor(readonly problem: ApiFailure) {
    super('Collection state could not be confirmed.');
  }
}
export const uncertainCommand = (error: unknown) =>
  error instanceof CollectionError &&
  (['network', 'timeout', 'protocol'].includes(error.problem.category) ||
    (error.problem.status ?? 0) >= 500);
function data<T>(result: ApiResult<T>): T {
  if (result.kind === 'data' || result.kind === 'pending') return result.data;
  throw new CollectionError(
    result.kind === 'error' ? result : failure('protocol', 'UNEXPECTED_COLLECTION_RESPONSE'),
  );
}
export function createCollectionClient(session: CreatorSession, clock = () => performance.now()) {
  const scope = session.getSnapshot().scope;
  const ownerId = session.getSnapshot().user?.id;
  const attempts = new WeakSet<StartAttempt>();
  let commanding = false;
  const active = () => {
    const current = session.getSnapshot();
    if (scope.signal.aborted || current.scope !== scope || current.phase !== 'authenticated')
      throw new CollectionError(failure('authority', 'AUTHORITY_CHANGED'));
  };
  const request = async <T>(input: JsonRequest<T>) => {
    active();
    const result = await session.request(input);
    active();
    return data(result);
  };
  const id = (value: string) => {
    if (!RoundParamsSchema.safeParse({ id: value }).success)
      throw new CollectionError(failure('configuration', 'INVALID_ROUND_ID'));
    return value;
  };
  const readRound = async (
    input: JsonRequest<ReturnType<typeof RoundResponseSchema.parse>>,
    expectedId?: string,
    start?: StartRoundInput,
  ): Promise<RoundRead> => {
    const requestedAt = clock();
    const value = await request(input);
    if (
      value.data.ownerId !== ownerId ||
      (expectedId && value.data.id !== expectedId) ||
      (start &&
        (value.data.connectionId !== start.connectionId ||
          value.data.broadcastId !== start.broadcastId ||
          value.data.collectionDurationSeconds !== start.collectionDurationSeconds ||
          (value.data.streamerContext?.value ?? undefined) !== start.streamerContext ||
          value.data.categoryKey !== (start.categoryKey ?? null) ||
          (value.data.announcementPinMode ?? 'off') !== (start.announcementPinMode ?? 'off')))
    )
      throw new CollectionError(failure('protocol', 'COLLECTION_RESOURCE_MISMATCH'));
    return { round: value.data, serverTime: value.serverTime, requestedAt, receivedAt: clock() };
  };
  const command = async <T>(run: () => Promise<T>) => {
    active();
    if (commanding) throw new CollectionError(failure('authority', 'COMMAND_IN_PROGRESS'));
    commanding = true;
    try {
      return await run();
    } finally {
      commanding = false;
    }
  };
  const access = createCreatorAccessClient({ origin: session.origin!, session });
  return {
    async connections(cursor: string | null, signal: AbortSignal) {
      active();
      const value = await access.connections(cursor, signal);
      active();
      return value;
    },
    async broadcasts(connectionId: string, cursor: string | null, signal: AbortSignal) {
      id(connectionId);
      const parsed = BroadcastsQuerySchema.safeParse({
        limit: '100',
        ...(cursor ? { cursor } : {}),
      });
      if (!parsed.success)
        throw new CollectionError(failure('configuration', 'INVALID_BROADCAST_CURSOR'));
      const query = new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) });
      const value = await request({
        path: `/api/connections/${connectionId}/broadcasts?${query}`,
        signal,
        schema: BroadcastsResponseSchema,
        success: [200],
      });
      return { ...value.data, serverTime: value.serverTime, receivedAt: clock() };
    },
    prepareStart(input: unknown): StartAttempt {
      active();
      const parsed = StartRoundInputSchema.safeParse(input);
      if (!parsed.success)
        throw new CollectionError(failure('configuration', 'INVALID_START_INPUT'));
      const attempt = Object.freeze({
        input: Object.freeze(parsed.data),
        key: crypto.randomUUID(),
        scopeId: scope.id,
      });
      attempts.add(attempt);
      return attempt;
    },
    start(attempt: StartAttempt) {
      return command(() => {
        if (!attempts.has(attempt) || attempt.scopeId !== scope.id)
          throw new CollectionError(failure('authority', 'INVALID_START_ATTEMPT'));
        return readRound(
          {
            path: '/api/rounds',
            method: 'POST',
            body: attempt.input,
            idempotencyKey: attempt.key,
            schema: RoundResponseSchema,
            success: [202],
          },
          undefined,
          attempt.input,
        );
      });
    },
    round(roundId: string, signal: AbortSignal) {
      return readRound(
        { path: `/api/rounds/${id(roundId)}`, signal, schema: RoundResponseSchema, success: [200] },
        roundId,
      );
    },
    stop(round: Pick<RoundDto, 'id' | 'version'>) {
      return command(() => {
        const parsed = StopRoundInputSchema.safeParse({ expectedVersion: round.version });
        if (!parsed.success)
          throw new CollectionError(failure('configuration', 'INVALID_STOP_INPUT'));
        return readRound(
          {
            path: `/api/rounds/${id(round.id)}/collection/stop`,
            method: 'POST',
            body: parsed.data,
            schema: RoundResponseSchema,
            success: [202],
          },
          round.id,
        );
      });
    },
  };
}
export type CollectionClient = ReturnType<typeof createCollectionClient>;
