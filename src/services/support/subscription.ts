import { SupportLiveEventSchema } from '@/services/contracts/index';
import { createSseParser } from '@/services/realtime/index';
import type { CreatorSession } from '@/services/creator-session/index';

export type SupportStreamPhase = 'connecting' | 'live' | 'reconnecting' | 'unavailable' | 'closed';
/** Support has no replay IDs, message payloads or overlay reducer. Each socket resyncs HTTP. */
export function subscribeSupport(options: {
  session: CreatorSession;
  ticketId: string;
  onReset: () => void;
  onPhase: (phase: SupportStreamPhase) => void;
  onDenied: () => void;
  fetcher?: typeof fetch;
}) {
  const scope = options.session.getSnapshot().scope;
  const lifetime = new AbortController();
  const signal = AbortSignal.any([scope.signal, lifetime.signal]);
  let retryMs = 1000,
    failures = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  const active = () => !signal.aborted && options.session.getSnapshot().scope === scope;
  const phase = (value: SupportStreamPhase) => {
    if (active()) options.onPhase(value);
  };
  const delay = (ms: number) =>
    new Promise<void>((done) => {
      const close = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', close);
        done();
      };
      timer = setTimeout(close, ms);
      signal.addEventListener('abort', close, { once: true });
      if (signal.aborted) close();
    });
  const run = async () => {
    if (!options.session.origin || !/^[0-9a-f-]{36}$/i.test(options.ticketId)) {
      phase('unavailable');
      return;
    }
    while (active()) {
      phase(failures ? 'reconnecting' : 'connecting');
      options.onReset();
      const socket = new AbortController();
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      let seen = false;
      let last = '';
      let terminal = false;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const cancel = () => {
        void reader?.cancel().catch(() => {});
      };
      signal.addEventListener('abort', cancel, { once: true });
      const touch = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => socket.abort(), 45_000);
      };
      try {
        touch();
        const response = await (options.fetcher ?? fetch)(
          options.session.origin + '/api/support/tickets/' + options.ticketId + '/events',
          {
            credentials: 'include',
            cache: 'no-store',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            headers: { Accept: 'text/event-stream' },
            signal: AbortSignal.any([signal, socket.signal]),
          },
        );
        if (!active()) return;
        if ([401, 403, 404].includes(response.status)) {
          terminal = true;
          options.onDenied();
          if (response.status === 401) void options.session.inspect();
          return;
        }
        if (response.status === 429 || response.status === 503) {
          const retry = response.headers.get('retry-after');
          if (retry && /^\d{1,5}$/.test(retry)) retryMs = Math.max(1000, Number(retry) * 1000);
          throw new Error('Unavailable');
        }
        if (
          !response.ok ||
          response.redirected ||
          !response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream') ||
          !response.body
        ) {
          terminal = true;
          throw new Error('Invalid support stream');
        }
        let revision = -1,
          readSequence = -1;
        const parser = createSseParser(
          (frame) => {
            if (!active()) return;
            let payload: unknown;
            try {
              payload = JSON.parse(frame.data);
            } catch {
              terminal = true;
              throw new Error('Invalid support JSON');
            }
            const parsed = SupportLiveEventSchema.safeParse({
              event: frame.event,
              data: payload,
            });
            if (
              !parsed.success ||
              frame.id !== '' ||
              parsed.data.data.ticketId !== options.ticketId
            ) {
              terminal = true;
              throw new Error('Invalid support hint');
            }
            const { event, data } = parsed.data;
            if (data.revision < revision || data.readSequence < readSequence) {
              terminal = true;
              throw new Error('Regressing support hint');
            }
            if (!seen && event !== 'resync_required') {
              terminal = true;
              throw new Error('Missing support resync');
            }
            const serialized = JSON.stringify(data);
            if (event === 'heartbeat' && serialized !== last) {
              terminal = true;
              throw new Error('Invalid heartbeat');
            }
            seen = true;
            failures = 0;
            phase('live');
            if (event !== 'heartbeat') options.onReset();
            last = serialized;
            revision = data.revision;
            readSequence = data.readSequence;
            touch();
          },
          (milliseconds) => {
            retryMs = Math.min(30_000, Math.max(500, milliseconds));
          },
          16_384,
        );
        reader = response.body.getReader();
        while (active()) {
          const part = await reader.read();
          if (!active()) break;
          if (part.done) {
            parser.end();
            break;
          }
          parser.push(part.value);
        }
      } catch {
        if (!active()) return;
      } finally {
        signal.removeEventListener('abort', cancel);
        clearTimeout(watchdog);
        socket.abort();
        await reader?.cancel().catch(() => {});
      }
      if (!active()) return;
      options.onReset();
      if (terminal || ++failures >= 5) {
        phase('unavailable');
        return;
      }
      phase('reconnecting');
      await delay(retryMs * Math.min(8, 2 ** (failures - 1)));
    }
  };
  void run();
  const unregister = scope.onDispose(() => lifetime.abort());
  return () => {
    lifetime.abort();
    clearTimeout(timer);
    unregister();
  };
}
