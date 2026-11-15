import type { AnalysisLiveEvent } from '@/services/contracts/index';

export type AnalysisLiveRoundState = Extract<AnalysisLiveEvent, { type: 'round-state' }>['state'];
export type AnalysisLiveIdea = { id: string; title: string; supporterCount: number; order: number };
export type AnalysisLiveResult = {
  resultVersion: string;
  provisional: boolean;
  settling: boolean;
  suggestions: (AnalysisLiveIdea & { reason: string })[];
};
export type AnalysisLiveState = {
  roundId: string;
  roundState: AnalysisLiveRoundState | null;
  preview: AnalysisLiveIdea[];
  result: AnalysisLiveResult | null;
};

export const createAnalysisLiveState = (roundId: string): AnalysisLiveState => ({
  roundId,
  roundState: null,
  preview: [],
  result: null,
});

const byOrder = <T extends { order: number }>(items: readonly T[]) =>
  [...items].sort((a, b) => a.order - b.order);

/** Pure reducer for the creator live analysis stream. Every event replaces, never accumulates. */
export function applyAnalysisLiveEvent(
  state: AnalysisLiveState,
  event: AnalysisLiveEvent,
): AnalysisLiveState {
  if (event.roundId !== state.roundId) return state;
  switch (event.type) {
    case 'round-state':
      return event.state === 'failed'
        ? { ...state, roundState: 'failed', preview: [], result: null }
        : { ...state, roundState: event.state };
    case 'preview':
      // A preview after a published result is stale for this view.
      return state.result ? state : { ...state, preview: byOrder(event.suggestions) };
    case 'published':
      return {
        ...state,
        preview: [],
        result: {
          resultVersion: event.resultVersion,
          provisional: event.provisional,
          settling: event.settling,
          suggestions: byOrder(event.suggestions),
        },
      };
    case 'supporters': {
      const result = state.result;
      if (!result || result.resultVersion !== event.resultVersion) return state;
      const counts = new Map(event.counts.map((count) => [count.id, count.supporterCount]));
      return {
        ...state,
        result: {
          ...result,
          settling: event.settling,
          suggestions: result.suggestions.map((idea) => ({
            ...idea,
            supporterCount: counts.get(idea.id) ?? idea.supporterCount,
          })),
        },
      };
    }
  }
}

/** True when nothing further can change: a failed round or a fully settled result. */
export const analysisLiveFinished = (state: AnalysisLiveState) =>
  state.roundState === 'failed' || (state.result !== null && !state.result.settling);
