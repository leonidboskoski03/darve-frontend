import {
  AnalysisLiveEventSchema,
  RoundParamsSchema,
  SessionResponseSchema,
  parseConsumerResponse,
} from '@/services/contracts/index';
import { failure, type ApiFailure } from '@/services/api/index';
import type { AuthorityScope } from '@/services/server-state/index';
import { createSseParser, type SseFrame } from './sse-parser';
import {
  analysisLiveFinished,
  applyAnalysisLiveEvent,
  createAnalysisLiveState,
  type AnalysisLiveState,
} from './analysis-live-state';

type Phase =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'finished'
  | 'denied'
  | 'unavailable'
  | 'protocol_error'
  | 'stopped';
export type AnalysisLiveSnapshot = AnalysisLiveState & {
  phase: Phase;
  error: ApiFailure | null;
};
class ProtocolError extends Error {}
const EVENT_ID = /^[a-f0-9]{64}$/;

/**
 * Read-only creator stream of the live analysis preview and published top ten for one round.
 * The server rotates connections; this client resumes with Last-Event-ID until the result settles.
 */
export function createAnalysisLiveSubscription(options: {
  origin: string;
  roundId: string;
  scope: AuthorityScope;
  fetcher?: typeof fetch;
  random?: () => number;
}) {
  const { scope } = options;
  if (scope.audience !== 'creator') throw new Error('Invalid analysis stream authority.');
  const roundId = RoundParamsSchema.parse({ id: options.roundId }).id.toLowerCase();
  const url = `${options.origin}/api/rounds/${encodeURIComponent(roundId)}/analysis/events`;
  const fetcher = options.fetcher ?? fetch;
  const random = options.random ?? Math.random;
  let state = createAnalysisLiveState(roundId);
  let phase: Phase = 'idle';
  let error: ApiFailure | null = null;
  let running = false,
    closed = false,
    epoch = 0,
    attempts = 0,
    retryMs = 2000;
  let cursor: string | null = null;
  let active: AbortController | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let unregister = () => {};
  let published: AnalysisLiveSnapshot = { ...state, phase, error };
  const listeners = new Set<() => void>();
  const publish = () => {
    if (
      published.phase === phase &&
      published.error === error &&
      published.roundState === state.roundState &&
      published.preview === state.preview &&
      published.result === state.result
    )
      return;
    published = { ...state, phase, error };
    listeners.forEach((listener) => listener());
  };
  const valid = (id: number) => running && !scope.signal.aborted && epoch === id;
  const delay = (hint = 0) =>
    Math.min(
      300_000,
      Math.max(
        hint,
        retryMs,
        Math.min(30_000, 2000 * 2 ** Math.min(attempts++, 4) + Math.floor(random() * 500)),
      ),
    );
  function terminate(next: Phase, problem: ApiFailure | null = null) {
    if (closed) return;
    closed = true;
    running = false;
    epoch++;
    if (retryTimer) clearTimeout(retryTimer);
    active?.abort();
    active = undefined;
    phase = next;
    error = problem;
    unregister();
    publish();
  }
  async function connect() {
    if (!running || closed || scope.signal.aborted) return;
    const id = ++epoch,
      controller = new AbortController();
    active = controller;
    const signal = AbortSignal.any([scope.signal, controller.signal]);
    phase = attempts ? 'reconnecting' : 'connecting';
    publish();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const abortConnection = () => {
      controller.abort();
      void reader?.cancel().catch(() => {});
    };
    // The server sends heartbeat comments while quiet; silence means a dead connection.
    let watchdog = setTimeout(abortConnection, 15_000);
    let retryHint = 0;
    try {
      const headers = new Headers({ Accept: 'text/event-stream' });
      if (cursor) headers.set('Last-Event-ID', cursor);
      const response = await fetcher(url, {
        method: 'GET',
        headers,
        credentials: 'include',
        signal,
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (!valid(id) || signal.aborted) {
        await response.body?.cancel();
        return;
      }
      if (response.status !== 200) {
        const result = parseConsumerResponse(
          {
            status: response.status,
            contentType: response.headers.get('content-type'),
            bodyText: await response.text(),
          },
          SessionResponseSchema,
        );
        if (!valid(id)) return;
        if (result.kind !== 'error' || result.action === 'protocol_error')
          throw new ProtocolError();
        const problem: ApiFailure = { ...result, category: 'http' };
        if (result.action !== 'retry' || ![429, 503].includes(result.status ?? 0)) {
          terminate([401, 403].includes(result.status ?? 0) ? 'denied' : 'unavailable', problem);
          return;
        }
        retryHint = (result.retryAfterSeconds ?? 2) * 1000;
        if (retryHint > 300_000) {
          terminate('unavailable', problem);
          return;
        }
        error = problem;
        return;
      }
      if (
        response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
          'text/event-stream' ||
        !response.body
      )
        throw new ProtocolError();
      phase = 'live';
      error = null;
      publish();
      const parser = createSseParser(
        (frame: SseFrame) => {
          if (!valid(id) || signal.aborted) return;
          let input: unknown;
          try {
            input = JSON.parse(frame.data);
          } catch {
            throw new ProtocolError();
          }
          const parsed = AnalysisLiveEventSchema.safeParse(input);
          if (!parsed.success || parsed.data.type !== frame.event || !EVENT_ID.test(frame.id))
            throw new ProtocolError();
          if (parsed.data.roundId.toLowerCase() !== roundId) throw new ProtocolError();
          cursor = frame.id;
          attempts = 0;
          state = applyAnalysisLiveEvent(state, parsed.data);
          publish();
        },
        (value) => {
          retryMs = Math.max(2000, Math.min(300_000, value));
        },
      );
      reader = response.body.getReader();
      while (valid(id) && !signal.aborted) {
        clearTimeout(watchdog);
        watchdog = setTimeout(abortConnection, 20_000);
        const chunk = await reader.read();
        if (!valid(id) || signal.aborted) return;
        if (chunk.done) {
          try {
            parser.end();
          } catch {
            throw new ProtocolError();
          }
          break;
        }
        try {
          parser.push(chunk.value);
        } catch {
          throw new ProtocolError();
        }
        if (analysisLiveFinished(state)) {
          terminate('finished');
          return;
        }
      }
    } catch (caught) {
      if (valid(id) && caught instanceof ProtocolError)
        terminate('protocol_error', failure('protocol', 'INVALID_STREAM'));
      else if (valid(id)) error = failure('network', 'STREAM_DISCONNECTED');
    } finally {
      clearTimeout(watchdog);
      controller.abort();
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (valid(id)) {
        if (analysisLiveFinished(state)) terminate('finished');
        else {
          phase = 'reconnecting';
          publish();
          retryTimer = setTimeout(() => {
            void connect();
          }, delay(retryHint));
        }
      }
    }
  }
  return {
    getSnapshot: () => published,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      // React StrictMode repeats effect setup after cleanup for the same scope.
      // A new epoch fences the old reader and clears its private snapshot.
      if (closed && phase === 'stopped' && !scope.signal.aborted) {
        closed = false;
        state = createAnalysisLiveState(roundId);
        cursor = null;
        attempts = 0;
        error = null;
        phase = 'idle';
      }
      if (closed || running) return;
      if (scope.signal.aborted) {
        terminate('stopped');
        return;
      }
      running = true;
      unregister = scope.onDispose(() => terminate('stopped'));
      void connect();
    },
    stop() {
      terminate('stopped');
    },
  };
}
