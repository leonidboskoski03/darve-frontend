import type { AnalysisLiveEvent } from '../contracts/index';

export const roundId = '10000000-0000-4000-8000-000000000001';
export const resultVersion = '20000000-0000-4000-8000-000000000002';
export const otherVersion = '30000000-0000-4000-8000-000000000003';

const hexId = (seed: number) => seed.toString(16).padStart(32, 'a');
export const idea = (order: number, supporterCount = 20 - order, title = `Idea ${order}`) => ({
  id: hexId(order),
  title,
  supporterCount,
  order,
});
export const state = (value: Extract<AnalysisLiveEvent, { type: 'round-state' }>['state']) =>
  ({ type: 'round-state', roundId, state: value }) as const satisfies AnalysisLiveEvent;
export const preview = (...suggestions: ReturnType<typeof idea>[]) =>
  ({
    type: 'preview',
    roundId,
    label: 'live preview, not final',
    suggestions,
  }) as const satisfies AnalysisLiveEvent;
export const publishedEvent = (settling = true, provisional = false, count = 3) =>
  ({
    type: 'published',
    roundId,
    resultVersion,
    provisional,
    settling,
    suggestions: Array.from({ length: count }, (_, index) => ({
      id: `g${index + 1}`,
      title: `Final ${index + 1}`,
      supporterCount: 30 - index,
      order: index + 1,
      reason: `Reason ${index + 1}`,
    })),
  }) as const satisfies AnalysisLiveEvent;
export const supporters = (settling: boolean, version = resultVersion) =>
  ({
    type: 'supporters',
    roundId,
    resultVersion: version,
    settling,
    counts: [
      { id: 'g1', supporterCount: 41, order: 1 },
      { id: 'g2', supporterCount: 35, order: 2 },
    ],
  }) as const satisfies AnalysisLiveEvent;

let sequence = 0;
/** One SSE frame; the id is an opaque 64-hex cursor like the server's. */
export const wire = (event: AnalysisLiveEvent, id = (++sequence).toString(16).padStart(64, '0')) =>
  `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
