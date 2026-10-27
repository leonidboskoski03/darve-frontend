import {
  OverlayParamsSchema,
  OverlayReaderQuerySchema,
  OverlaySnapshotResponseSchema,
  OverlaySnapshotV2ResponseSchema,
  OverlayEventSchema,
  OverlayEventV2Schema,
  SessionResponseSchema,
  parseConsumerResponse,
} from '@/services/contracts/index';
import { createJsonClient, failure, type ApiFailure, type ApiResult } from '@/services/api/index';
import type { AuthorityScope } from '@/services/server-state/index';
import { createSseParser, type SseFrame } from './sse-parser';
import {
  createOverlayState,
  applySnapshot,
  applyEvent,
  disconnectOverlay,
  overlayView,
  type OverlayFrame,
} from './overlay-state';

type Phase =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'resyncing'
  | 'stale'
  | 'reconnecting'
  | 'denied'
  | 'unavailable'
  | 'protocol_error'
  | 'stopped';
export type OverlayStreamSnapshot = ReturnType<typeof overlayView> & {
  phase: Phase;
  error: ApiFailure | null;
};
const owners = new WeakSet<AuthorityScope>();
class ProtocolError extends Error {}

/** One read-only display/grant/protocol per overlay authority. Bootstrap belongs to the owning feature. */
export function createOverlaySubscription(options: {
  origin: string;
  displayId: string;
  grantId: string;
  protocol: 1 | 2;
  scope: AuthorityScope;
  fetcher?: typeof fetch;
  now?: () => number;
  random?: () => number;
}) {
  const { scope, protocol } = options;
  const displayId = OverlayParamsSchema.parse({ id: options.displayId }).id.toLowerCase();
  const readerQuery = OverlayReaderQuerySchema.parse({
    grantId: options.grantId,
    ...(protocol === 2 ? { protocolVersion: '2' } : {}),
  });
  if (scope.audience !== 'overlay' || (protocol !== 1 && protocol !== 2))
    throw new Error('Invalid overlay authority configuration.');
  const client = createJsonClient({
    origin: options.origin,
    audience: 'overlay',
    lifetime: scope.signal,
    fetcher: options.fetcher,
  });
  const query = new URLSearchParams({
    grantId: readerQuery.grantId!.toLowerCase(),
    ...(protocol === 2 ? { protocolVersion: '2' } : {}),
  });
  const base = `/api/overlays/${displayId}`;
  const now = options.now ?? (() => performance.now());
  const random = options.random ?? Math.random;
  const fetcher = options.fetcher ?? fetch;
  let state = createOverlayState(displayId, protocol);
  let phase: Phase = 'idle',
    error: ApiFailure | null = null;
  let claimed = false;
  let running = false,
    closed = false,
    connected = false,
    epoch = 0;
  let active: AbortController | undefined, snapshotAbort: AbortController | undefined;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let snapshotPending = false,
    snapshotNumber = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  let tick: ReturnType<typeof setInterval> | undefined;
  let cursor: string | null = null,
    retryMs = 2000,
    attempts = 0;
  let unregister = () => {};
  let published: OverlayStreamSnapshot = { phase, error, snapshot: null, presentation: null };
  const listeners = new Set<() => void>();
  const publish = () => {
    const view = overlayView(state, now(), connected);
    const currentPhase = connected
      ? state.needsRefetch
        ? 'resyncing'
        : view.snapshot
          ? 'live'
          : 'stale'
      : phase;
    if (
      currentPhase === published.phase &&
      error === published.error &&
      view.snapshot === published.snapshot &&
      JSON.stringify(view.presentation) === JSON.stringify(published.presentation)
    )
      return;
    published = { ...view, phase: currentPhase, error };
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
  const clearConnection = () => {
    connected = false;
    void activeReader?.cancel().catch(() => {});
    activeReader = undefined;
    active?.abort();
    active = undefined;
    snapshotAbort?.abort();
    snapshotAbort = undefined;
    snapshotPending = false;
    if (snapshotTimer) clearTimeout(snapshotTimer);
    state = disconnectOverlay(state);
    if (claimed) scope.queryClient.removeQueries({ queryKey: scope.key(['overlay-snapshot']) });
  };
  function terminate(next: Phase, problem: ApiFailure | null = null) {
    if (closed) return;
    closed = true;
    running = false;
    epoch++;
    if (retryTimer) clearTimeout(retryTimer);
    if (tick) clearInterval(tick);
    clearConnection();
    phase = next;
    error = problem;
    if (claimed) owners.delete(scope);
    claimed = false;
    unregister();
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', publish);
      document.removeEventListener('visibilitychange', publish);
    }
    publish();
  }
  const terminalFailure = (problem: ApiFailure) => {
    terminate(
      problem.category === 'protocol'
        ? 'protocol_error'
        : [401, 403].includes(problem.status ?? 0)
          ? 'denied'
          : 'unavailable',
      problem,
    );
  };
  async function refetch(id: number) {
    if (!valid(id) || !connected || snapshotPending) return;
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotPending = true;
    const controller = new AbortController();
    snapshotAbort = controller;
    const floor = state.versionFloor;
    const timeFloor = state.serverTimeFloorMs;
    const key = [
      'overlay-snapshot',
      displayId,
      readerQuery.grantId,
      protocol,
      id,
      ++snapshotNumber,
    ];
    try {
      const result = await scope.query<ApiResult<OverlayFrame>>(key, (signal) => {
        const input = {
          path: base + '/snapshot?' + query.toString(),
          success: [200] as const,
          signal: AbortSignal.any([signal, controller.signal]),
        };
        return protocol === 1
          ? client({ ...input, schema: OverlaySnapshotResponseSchema })
          : client({ ...input, schema: OverlaySnapshotV2ResponseSchema });
      });
      if (!valid(id) || controller.signal.aborted || !connected) return;
      if (result.kind === 'data') {
        if (result.data.data.id !== displayId) {
          terminalFailure(failure('protocol', 'INVALID_SNAPSHOT'));
          return;
        }
        state = applySnapshot(state, result.data, now());
        if (!state.needsRefetch) {
          error = null;
          attempts = 0;
        }
        publish();
      } else if (result.kind === 'error') {
        error = result;
        if (
          result.category === 'network' ||
          result.category === 'timeout' ||
          (result.action === 'retry' && [429, 503].includes(result.status ?? 0))
        ) {
          if ((result.retryAfterSeconds ?? 0) > 300) {
            terminalFailure(result);
            return;
          }
          snapshotTimer = setTimeout(
            () => {
              void refetch(id);
            },
            Math.max(2000, (result.retryAfterSeconds ?? 2) * 1000),
          );
          publish();
        } else terminalFailure(result);
      } else terminalFailure(failure('protocol', 'INVALID_SNAPSHOT'));
    } catch {
      if (valid(id) && !controller.signal.aborted)
        terminalFailure(failure('protocol', 'INVALID_SNAPSHOT'));
    } finally {
      scope.queryClient.removeQueries({ queryKey: scope.key(key), exact: true });
      if (snapshotAbort === controller) {
        snapshotAbort = undefined;
        snapshotPending = false;
        if (
          valid(id) &&
          connected &&
          state.needsRefetch &&
          (state.versionFloor > floor || (state.serverTimeFloorMs ?? 0) > (timeFloor ?? 0))
        )
          void refetch(id);
      }
    }
  }
  async function connect() {
    if (!running || closed || scope.signal.aborted) return;
    const id = ++epoch,
      controller = new AbortController();
    active = controller;
    const signal = AbortSignal.any([scope.signal, controller.signal]);
    phase = attempts ? 'reconnecting' : 'connecting';
    error = null;
    publish();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const abortConnection = () => {
      controller.abort();
      void reader?.cancel().catch(() => {});
    };
    let watchdog = setTimeout(abortConnection, 15_000);
    let retryHint = 0,
      sawResync = false;
    try {
      const headers = new Headers({ Accept: 'text/event-stream' });
      if (cursor) headers.set('Last-Event-ID', cursor);
      const response = await fetcher(options.origin + base + '/events?' + query.toString(), {
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
      if (response.redirected || response.type === 'opaqueredirect') throw new ProtocolError();
      if (response.status === 204) {
        await response.body?.cancel();
        terminate('stopped');
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
          terminalFailure(problem);
          return;
        }
        retryHint = (result.retryAfterSeconds ?? 2) * 1000;
        if (retryHint > 300_000) {
          terminalFailure(problem);
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
      connected = true;
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
          const parsed =
            protocol === 1
              ? OverlayEventSchema.safeParse(input)
              : OverlayEventV2Schema.safeParse(input);
          if (
            !parsed.success ||
            parsed.data.eventId !== frame.id ||
            parsed.data.type !== frame.event
          )
            throw new ProtocolError();
          if (parsed.data.resourceId !== displayId) return;
          if (!sawResync && parsed.data.type !== 'resync_required') throw new ProtocolError();
          sawResync = true;
          if (parsed.data.resourceVersion >= state.versionFloor) cursor = parsed.data.eventId;
          state = applyEvent(state, parsed.data, now());
          if (!state.needsRefetch) {
            attempts = 0;
            error = null;
          }
          publish();
          if (state.needsRefetch) void refetch(id);
        },
        (value) => {
          if (value > 300_000) {
            terminate('unavailable', failure('protocol', 'STREAM_RETRY_DELAY_UNSUPPORTED'));
            return;
          }
          retryMs = Math.max(2000, value);
        },
      );
      reader = response.body.getReader();
      activeReader = reader;
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
        if (activeReader === reader) activeReader = undefined;
      }
      if (valid(id)) {
        clearConnection();
        phase = 'reconnecting';
        publish();
        retryTimer = setTimeout(() => {
          void connect();
        }, delay(retryHint));
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
      if (closed || running) return;
      if (scope.signal.aborted) {
        terminate('stopped');
        return;
      }
      if (owners.has(scope)) throw new Error('Overlay authority already has a subscription.');
      owners.add(scope);
      claimed = true;
      running = true;
      unregister = scope.onDispose(() => terminate('stopped'));
      tick = setInterval(publish, 250);
      if (typeof window !== 'undefined') {
        window.addEventListener('focus', publish);
        document.addEventListener('visibilitychange', publish);
      }
      void connect();
    },
    stop() {
      terminate('stopped');
    },
  };
}
