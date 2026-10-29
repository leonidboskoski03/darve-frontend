import {
  DashboardQuerySchema,
  DashboardResponseSchema,
  ChallengeParamsSchema,
  ChallengeResponseSchema,
  ChallengePageQuerySchema,
  ChallengePageResponseSchema,
  RoundParamsSchema,
  RoundAnalyticsResponseSchema,
  CompletionInputSchema,
  CompletionResponseSchema,
  type ChallengeDto,
  type DashboardQuery,
} from '@/services/contracts/index';
import { failure, type ApiFailure, type JsonRequest } from '@/services/api/index';
import type { CreatorSession } from '@/services/creator-session/index';
export type { ChallengeDto, DashboardQuery };
export type SummaryRead = ReturnType<typeof DashboardResponseSchema.parse>;
export type ChallengeRead = ReturnType<typeof ChallengeResponseSchema.parse>;
export type HistoryRead = ReturnType<typeof ChallengePageResponseSchema.parse>;
export type AnalyticsRead = ReturnType<typeof RoundAnalyticsResponseSchema.parse>;
export type Declaration = ReturnType<typeof CompletionResponseSchema.parse>['data'];
export type DeclarationAttempt = Readonly<{
  challengeId: string;
  broadcastId: string;
  provider: ChallengeDto['stream']['provider'];
  authorityRevision: number;
  continuationId: string | null;
  key: string;
  input: Readonly<ReturnType<typeof CompletionInputSchema.parse>>;
}>;
export class ReportingError extends Error {
  constructor(readonly problem: ApiFailure) {
    super('Reporting state could not be confirmed.');
  }
}
function invalid(): never {
  throw new ReportingError(failure('configuration', 'INVALID_REPORTING_INPUT'));
}
function mismatch(): never {
  throw new ReportingError(failure('protocol', 'REPORTING_RESOURCE_MISMATCH'));
}
export function reportingQuery(input: unknown): DashboardQuery {
  const parsed = DashboardQuerySchema.safeParse(input);
  if (!parsed.success) invalid();
  return parsed.data;
}
export const reportingParameters = (query: DashboardQuery) =>
  Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined);
export const defaultReportingZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export const declarationUncertain = (error: unknown) =>
  error instanceof ReportingError &&
  (['network', 'timeout', 'protocol'].includes(error.problem.category) ||
    (error.problem.status ?? 0) >= 500);
export const canDeclare = (challenge: ChallengeDto) =>
  challenge.contentAvailability === 'available' &&
  challenge.terms.text !== null &&
  challenge.funding.state === 'funded' &&
  challenge.performance.state === 'awaiting_performance';
export function reportingMessage(error: unknown) {
  if (!(error instanceof ReportingError))
    return 'This information could not be read. Refresh before continuing.';
  const { category, status, code } = error.problem;
  const messages: Record<string, string> = {
    INVALID_REPORTING_INPUT:
      'Check the timezone, paired dates and selected resource before continuing.',
    NOT_FUNDED: 'The server has not recognized this challenge as funded.',
    STALE_VERSION: 'The challenge authority changed. Refresh and review it again.',
    TERMS_CHANGED: 'The challenge terms changed. Refresh and confirm the current terms.',
    ALREADY_DECLARED: 'This challenge already has a completion declaration. Refresh its status.',
    CONTEXT_CHANGED:
      'The original or authorized stream could not be confirmed. Check that stream before declaring.',
    INPUT_RESTRICTED: 'The source is restricted. Completion cannot be declared.',
    IDEMPOTENCY_CONFLICT: 'This request identity does not match its original declaration.',
    TERMS_REQUIRED: 'Review the current account terms before continuing.',
  };
  if (messages[code]) return messages[code];
  if (status === 404) return 'This resource is unavailable for your account.';
  if (status === 401 || category === 'authority')
    return 'Your session changed. Check your account before continuing.';
  if (status === 403)
    return 'The server could not authorize this action. Check your session and current terms.';
  if (status === 409) return 'The challenge changed. Refresh and review it before another action.';
  if (status === 429) return 'Too many requests. Wait before refreshing.';
  return 'The result could not be confirmed. Check its current status before another action.';
}
export function createReportingClient(session: CreatorSession) {
  const scope = session.getSnapshot().scope,
    receipts = new WeakSet<DeclarationAttempt>();
  let commanding = false;
  const active = () => {
    const current = session.getSnapshot();
    if (scope.signal.aborted || current.scope !== scope || current.phase !== 'authenticated')
      throw new ReportingError(failure('authority', 'AUTHORITY_CHANGED'));
  };
  const request = async <T>(input: JsonRequest<T>): Promise<T> => {
    active();
    const result = await session.request(input);
    active();
    if (result.kind === 'data') return result.data;
    throw new ReportingError(
      result.kind === 'error' ? result : failure('protocol', 'UNEXPECTED_REPORTING_RESPONSE'),
    );
  };
  const challengePath = (id: string) => {
    if (!ChallengeParamsSchema.safeParse({ id }).success) invalid();
    return '/api/challenges/' + id;
  };
  const roundPath = (id: string) => {
    if (!RoundParamsSchema.safeParse({ id }).success) invalid();
    return '/api/rounds/' + id + '/analytics';
  };
  return {
    async summary(input: DashboardQuery, signal: AbortSignal) {
      const query = reportingQuery(input),
        params = new URLSearchParams(reportingParameters(query));
      const value = await request({
        path: '/api/dashboard/summary?' + params.toString(),
        signal,
        schema: DashboardResponseSchema,
        success: [200],
      });
      const data = value.data;
      if (
        data.period.timeZone !== query.timeZone ||
        (query.fromDate &&
          (data.period.fromDate !== query.fromDate ||
            data.period.throughDate !== query.throughDate)) ||
        data.currentStream.broadcastId !== (query.broadcastId ?? null) ||
        new Set(data.history.contributionsByCurrency.map((row) => row.currency)).size !==
          data.history.contributionsByCurrency.length
      )
        mismatch();
      return value;
    },
    async history(current: boolean, cursor: string | null, signal: AbortSignal) {
      const input = { limit: 50, ...(cursor ? { cursor } : {}) };
      if (!ChallengePageQuerySchema.safeParse(input).success) invalid();
      const query = new URLSearchParams({ limit: '50', ...(cursor ? { cursor } : {}) });
      const value = await request({
        path: '/api/challenges' + (current ? '/current' : '') + '?' + query.toString(),
        signal,
        schema: ChallengePageResponseSchema,
        success: [200],
      });
      if (
        value.data.nextCursor &&
        (!ChallengePageQuerySchema.safeParse({ cursor: value.data.nextCursor }).success ||
          value.data.nextCursor === cursor ||
          value.data.items.length === 0)
      )
        mismatch();
      return value;
    },
    async challenge(id: string, signal: AbortSignal) {
      const value = await request({
        path: challengePath(id),
        signal,
        schema: ChallengeResponseSchema,
        success: [200],
      });
      if (value.data.id !== id) mismatch();
      return value;
    },
    async analytics(id: string, signal: AbortSignal) {
      const value = await request({
        path: roundPath(id),
        signal,
        schema: RoundAnalyticsResponseSchema,
        success: [200],
      });
      if (value.data.roundId !== id) mismatch();
      return value;
    },
    prepare(challenge: ChallengeDto): DeclarationAttempt {
      active();
      challengePath(challenge.id);
      if (!canDeclare(challenge)) invalid();
      const authority = challenge.performanceAuthority,
        revision = authority?.revision ?? 0,
        broadcastId = authority?.broadcastId ?? challenge.stream.broadcastId,
        continuationId = authority?.authorizationId ?? null;
      if (
        (revision === 0 &&
          (continuationId !== null || broadcastId !== challenge.stream.broadcastId)) ||
        (revision > 0 && continuationId === null)
      )
        invalid();
      const parsed = CompletionInputSchema.safeParse({
        expectedVersion: challenge.performance.revision,
        termsVersion: challenge.terms.version,
        ...(authority ? { expectedPerformanceRevision: revision } : {}),
      });
      if (!parsed.success) invalid();
      const attempt = Object.freeze({
        challengeId: challenge.id,
        broadcastId,
        provider: challenge.stream.provider,
        authorityRevision: revision,
        continuationId,
        key: crypto.randomUUID(),
        input: Object.freeze(parsed.data),
      });
      receipts.add(attempt);
      return attempt;
    },
    async declare(attempt: DeclarationAttempt): Promise<Declaration> {
      active();
      if (!receipts.has(attempt)) invalid();
      if (commanding) throw new ReportingError(failure('authority', 'COMMAND_IN_PROGRESS'));
      commanding = true;
      try {
        const value = await request({
          path: challengePath(attempt.challengeId) + '/completion-declarations',
          method: 'POST',
          body: attempt.input,
          idempotencyKey: attempt.key,
          schema: CompletionResponseSchema,
          success: [200, 201],
        });
        const data = value.data;
        if (
          data.challengeId !== attempt.challengeId ||
          data.termsVersion !== attempt.input.termsVersion ||
          data.broadcastId !== attempt.broadcastId ||
          data.provider !== attempt.provider ||
          value.schemaVersion !== (attempt.continuationId ? 2 : 1) ||
          data.continuationId !== (attempt.continuationId ?? undefined) ||
          data.performanceAuthorityRevision !==
            (attempt.continuationId ? attempt.authorityRevision : undefined)
        )
          mismatch();
        return data;
      } finally {
        commanding = false;
      }
    },
  };
}
export type ReportingClient = ReturnType<typeof createReportingClient>;
