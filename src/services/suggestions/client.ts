import {
  RoundParamsSchema,
  SuggestionParamsSchema,
  SuggestionPageQuerySchema,
  SuggestionPageResponseSchema,
  SuggestionDispositionInputSchema,
  SuggestionResponseSchema,
  AcceptSuggestionInputSchema,
  AcceptSuggestionResponseSchema,
  ChallengeResponseSchema,
  contributionAmountMinor,
  type SuggestionDto,
  type AcceptSuggestionInput,
} from '@/services/contracts/index';
import { failure, type ApiFailure, type JsonRequest } from '@/services/api/index';
import type { CreatorSession } from '@/services/creator-session/index';

export type Suggestion = SuggestionDto;
export type ReviewPage = ReturnType<typeof SuggestionPageResponseSchema.parse>['data'];
export type AcceptedChallenge = ReturnType<typeof AcceptSuggestionResponseSchema.parse>['data'];
export type AcceptanceAttempt = Readonly<{
  roundId: string;
  suggestionId: string;
  text: string;
  key: string;
  input: Readonly<AcceptSuggestionInput>;
}>;
export class ReviewError extends Error {
  constructor(readonly problem: ApiFailure) {
    super('Review could not be confirmed.');
  }
}
function invalid(code = 'INVALID_REVIEW_INPUT'): never {
  throw new ReviewError(failure('configuration', code));
}
const mismatch = (): never => {
  throw new ReviewError(failure('protocol', 'REVIEW_RESOURCE_MISMATCH'));
};
export const uncertainReview = (error: unknown) =>
  error instanceof ReviewError &&
  error.problem.code !== 'POLICY_UNAVAILABLE' &&
  (['network', 'timeout', 'protocol'].includes(error.problem.category) ||
    (error.problem.status ?? 0) >= 500);
export function createSuggestionClient(session: CreatorSession) {
  const scope = session.getSnapshot().scope;
  const receipts = new WeakSet<AcceptanceAttempt>();
  let commanding = false;
  const active = () => {
    const current = session.getSnapshot();
    if (scope.signal.aborted || current.scope !== scope || current.phase !== 'authenticated')
      throw new ReviewError(failure('authority', 'AUTHORITY_CHANGED'));
  };
  const request = async <T>(input: JsonRequest<T>): Promise<T> => {
    active();
    const result = await session.request(input);
    active();
    if (result.kind === 'data') return result.data;
    throw new ReviewError(
      result.kind === 'error' ? result : failure('protocol', 'UNEXPECTED_REVIEW_RESPONSE'),
    );
  };
  const roundPath = (roundId: string) => {
    if (!RoundParamsSchema.safeParse({ id: roundId }).success) invalid();
    return `/api/rounds/${roundId}/suggestions`;
  };
  const itemPath = (item: Pick<Suggestion, 'roundId' | 'id'>) => {
    if (!SuggestionParamsSchema.safeParse({ id: item.roundId, suggestionId: item.id }).success)
      invalid();
    return `${roundPath(item.roundId)}/${item.id}`;
  };
  const command = async <T>(run: () => Promise<T>) => {
    active();
    if (commanding) throw new ReviewError(failure('authority', 'COMMAND_IN_PROGRESS'));
    commanding = true;
    try {
      return await run();
    } finally {
      commanding = false;
    }
  };
  return {
    async page(roundId: string, cursor: string | null, signal: AbortSignal): Promise<ReviewPage> {
      const path = roundPath(roundId);
      if (
        !SuggestionPageQuerySchema.safeParse({ limit: '50', ...(cursor ? { cursor } : {}) }).success
      )
        invalid();
      const query = new URLSearchParams({ limit: '50', ...(cursor ? { cursor } : {}) });
      const { data } = await request({
        path: `${path}?${query}`,
        signal,
        schema: SuggestionPageResponseSchema,
        success: [200],
      });
      const analysis = data.analysis;
      if (
        data.items.some(
          (item) =>
            item.roundId !== roundId ||
            item.id.split('.')[0] !== data.resultVersion ||
            item.analysisRunId !== analysis?.analysisRunId ||
            item.snapshotVersion !== analysis.snapshotVersion,
        ) ||
        (data.items.length > 0 && analysis?.state !== 'succeeded') ||
        data.resultVersion !== (analysis?.resultVersion ?? null) ||
        (data.nextCursor && data.nextCursor.split('.')[0] !== data.resultVersion) ||
        (cursor && cursor.split('.')[0] !== data.resultVersion)
      )
        mismatch();
      return data;
    },
    disposition(item: Suggestion, pinned: boolean, dismissed: boolean) {
      return command(async () => {
        const path = itemPath(item);
        const parsed = SuggestionDispositionInputSchema.safeParse({
          expectedVersion: item.version,
          pinned,
          dismissed,
        });
        if (!parsed.success) invalid();
        const { data } = await request({
          path: path + '/disposition',
          method: 'PATCH',
          body: parsed.data,
          schema: SuggestionResponseSchema,
          success: [200],
        });
        if (
          data.id !== item.id ||
          data.roundId !== item.roundId ||
          data.version < item.version ||
          data.analysisRunId !== item.analysisRunId ||
          data.snapshotVersion !== item.snapshotVersion ||
          data.pinned !== pinned ||
          data.dismissed !== dismissed
        )
          mismatch();
        return data;
      });
    },
    prepare(
      page: ReviewPage,
      item: Suggestion,
      terms: { decimal: string; currency: string; seconds: string },
    ): AcceptanceAttempt {
      active();
      itemPath(item);
      if (
        page.analysis?.state !== 'succeeded' ||
        !page.resultVersion ||
        !page.items.some((value) => value.id === item.id && value.version === item.version) ||
        page.items.some((value) => value.selectedChallengeId !== null) ||
        item.dismissed ||
        item.selectedChallengeId ||
        item.id.split('.')[0] !== page.resultVersion ||
        item.analysisRunId !== page.analysis.analysisRunId ||
        item.snapshotVersion !== page.analysis.snapshotVersion ||
        !/^[1-9][0-9]{0,9}$/.test(terms.seconds)
      )
        invalid();
      let amountMinor: string;
      try {
        amountMinor = contributionAmountMinor(terms.decimal, terms.currency);
      } catch {
        return invalid();
      }
      const parsed = AcceptSuggestionInputSchema.safeParse({
        expectedVersion: item.version,
        analysisRunId: item.analysisRunId,
        resultVersion: page.resultVersion,
        snapshotVersion: item.snapshotVersion,
        goal: { amountMinor, currency: terms.currency },
        fundingDurationSeconds: Number(terms.seconds),
      });
      if (!parsed.success) invalid();
      const attempt = Object.freeze({
        roundId: item.roundId,
        suggestionId: item.id,
        text: item.text,
        key: crypto.randomUUID(),
        input: Object.freeze({ ...parsed.data, goal: Object.freeze(parsed.data.goal) }),
      });
      receipts.add(attempt);
      return attempt;
    },
    accept(attempt: AcceptanceAttempt) {
      return command(async () => {
        if (!receipts.has(attempt)) invalid();
        const path = itemPath({ roundId: attempt.roundId, id: attempt.suggestionId });
        const { data } = await request({
          path: path + '/accept',
          method: 'POST',
          body: attempt.input,
          idempotencyKey: attempt.key,
          schema: AcceptSuggestionResponseSchema,
          success: [200, 201],
        });
        const expected = attempt.input;
        if (
          data.roundId !== attempt.roundId ||
          data.suggestionId !== attempt.suggestionId ||
          data.analysisRunId !== expected.analysisRunId ||
          data.resultVersion !== expected.resultVersion ||
          data.snapshotVersion !== expected.snapshotVersion ||
          data.goal.amountMinor !== expected.goal.amountMinor ||
          data.goal.currency !== expected.goal.currency ||
          data.fundingDurationSeconds !== expected.fundingDurationSeconds
        )
          mismatch();
        return data;
      });
    },
    async challenge(id: string, roundId: string, suggestionId: string, signal: AbortSignal) {
      if (!RoundParamsSchema.safeParse({ id }).success) invalid();
      itemPath({ roundId, id: suggestionId });
      const { data } = await request({
        path: `/api/challenges/${id}`,
        signal,
        schema: ChallengeResponseSchema,
        success: [200],
      });
      if (
        data.id !== id ||
        data.roundId !== roundId ||
        data.terms.sourceSuggestionId !== suggestionId
      )
        mismatch();
      return data;
    },
  };
}
export type SuggestionClient = ReturnType<typeof createSuggestionClient>;
