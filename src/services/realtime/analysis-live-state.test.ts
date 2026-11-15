import { describe, expect, it } from 'vitest';
import {
  analysisLiveFinished,
  applyAnalysisLiveEvent,
  createAnalysisLiveState,
} from './analysis-live-state';
import {
  idea,
  otherVersion,
  preview,
  publishedEvent,
  roundId,
  state,
  supporters,
} from './analysis-live.test-support';

const start = () => createAnalysisLiveState(roundId);

describe('analysis live state', () => {
  it('replaces the whole preview on every event and orders it by rank', () => {
    let current = applyAnalysisLiveEvent(start(), preview(idea(2), idea(1)));
    expect(current.preview.map((item) => item.order)).toEqual([1, 2]);
    current = applyAnalysisLiveEvent(current, preview());
    expect(current.preview).toEqual([]);
  });

  it('switches from preview to the published result and ignores later previews', () => {
    let current = applyAnalysisLiveEvent(start(), preview(idea(1)));
    current = applyAnalysisLiveEvent(current, state('published'));
    current = applyAnalysisLiveEvent(current, publishedEvent());
    expect(current.preview).toEqual([]);
    expect(current.result?.suggestions[0]).toMatchObject({ id: 'g1', reason: 'Reason 1' });
    current = applyAnalysisLiveEvent(current, preview(idea(1)));
    expect(current.preview).toEqual([]);
  });

  it('updates counts only for the matching result version and keeps the order fixed', () => {
    let current = applyAnalysisLiveEvent(start(), publishedEvent());
    const stale = applyAnalysisLiveEvent(current, supporters(false, otherVersion));
    expect(stale).toBe(current);
    current = applyAnalysisLiveEvent(current, supporters(false));
    expect(current.result?.suggestions.map((s) => [s.id, s.supporterCount])).toEqual([
      ['g1', 41],
      ['g2', 35],
      ['g3', 28],
    ]);
    expect(analysisLiveFinished(current)).toBe(true);
  });

  it('clears everything visible when the round fails', () => {
    let current = applyAnalysisLiveEvent(start(), publishedEvent());
    current = applyAnalysisLiveEvent(current, state('failed'));
    expect(current).toMatchObject({ roundState: 'failed', preview: [], result: null });
    expect(analysisLiveFinished(current)).toBe(true);
  });

  it('ignores events for another round', () => {
    const current = start();
    expect(applyAnalysisLiveEvent(current, { ...preview(idea(1)), roundId: otherVersion })).toBe(
      current,
    );
  });

  it('is not finished while the result is still settling', () => {
    expect(analysisLiveFinished(applyAnalysisLiveEvent(start(), publishedEvent(true)))).toBe(false);
    expect(analysisLiveFinished(applyAnalysisLiveEvent(start(), publishedEvent(false)))).toBe(true);
  });
});
