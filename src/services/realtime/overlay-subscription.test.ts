import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthorityScope, type AuthorityScope } from '@/services/server-state/index';
import { createOverlaySubscription } from './overlay-subscription';
import {
  displayId,
  grantId,
  foreignId,
  makeFrame,
  makeEvent,
  wireEvent,
  iso,
} from './fixtures.test-support';

const encoder = new TextEncoder();
const requestUrl = (input: Parameters<typeof fetch>[0] | undefined) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : (input?.url ?? '');
function stream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel,
  });
  return {
    response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    cancel,
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const errorBody = (retryAfterSeconds = 2) => ({
  schemaVersion: 1,
  serverTime: iso(1),
  error: {
    code: 'SAFE_CODE',
    message: 'private-error-marker',
    requestId: 'synthetic-request',
    retryable: true,
    retryAfterSeconds,
    issues: [],
    refetch: null,
  },
});
const flush = async () => {
  for (let count = 0; count < 40; count++) await Promise.resolve();
};
const scopes: AuthorityScope[] = [];
let clock = 100;
function setup(send: typeof fetch, protocol: 1 | 2 = 1, scope = createAuthorityScope('overlay')) {
  scopes.push(scope);
  const subscription = createOverlaySubscription({
    origin: 'https://api.example.test',
    displayId,
    grantId,
    protocol,
    scope,
    fetcher: send,
    now: () => clock,
    random: () => 0,
  });
  subscription.start();
  return { subscription, scope };
}
beforeEach(() => {
  vi.useFakeTimers();
  clock = 100;
});
afterEach(() => {
  scopes.forEach((scope) => scope.dispose());
  scopes.length = 0;
  vi.useRealTimers();
});

describe.each([1, 2] as const)('protocol %s overlay stream', (protocol) => {
  it('refetches initial resync on the SAME connection and sends only reader credentials/status policy', async () => {
    const source = stream();
    const send = vi
      .fn<typeof fetch>()
      .mockImplementation((url) =>
        Promise.resolve(
          requestUrl(url).includes('/events?') ? source.response : json(makeFrame(protocol, 1, 1)),
        ),
      );
    const { subscription } = setup(send, protocol);
    source.send('retry: 2000\n\n' + wireEvent(makeEvent(makeFrame(protocol), 'resync_required')));
    await flush();
    expect(subscription.getSnapshot()).toMatchObject({ phase: 'live', snapshot: { version: 1 } });
    expect(send).toHaveBeenCalledTimes(2);
    expect(requestUrl(send.mock.calls[0]?.[0])).toContain(`/events?grantId=${grantId}`);
    expect(requestUrl(send.mock.calls[0]?.[0]).includes('protocolVersion=2')).toBe(protocol === 2);
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'include',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    expect(new Headers(send.mock.calls[0]?.[1]?.headers).has('X-CSRF-Token')).toBe(false);
    expect(send.mock.calls.every((call) => call[1]?.method === 'GET')).toBe(true);
  });

  it('hides on EOF and reconnects with its validated cursor without re-bootstrap or an overlapping stream', async () => {
    const first = stream(),
      second = stream();
    let opens = 0;
    const send = vi
      .fn<typeof fetch>()
      .mockImplementation((url) =>
        Promise.resolve(
          requestUrl(url).includes('/events?')
            ? ++opens === 1
              ? first.response
              : second.response
            : json(makeFrame(protocol, 1, opens)),
        ),
      );
    const { subscription } = setup(send, protocol);
    first.send(wireEvent(makeEvent(makeFrame(protocol), 'resync_required')));
    await flush();
    first.end();
    await flush();
    expect(subscription.getSnapshot()).toMatchObject({ phase: 'reconnecting', snapshot: null });
    await vi.advanceTimersByTimeAsync(1999);
    expect(opens).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(opens).toBe(2);
    const reconnect = send.mock.calls.filter((call) => requestUrl(call[0]).includes('/events?'))[1];
    expect(new Headers(reconnect?.[1]?.headers).get('Last-Event-ID')).toBe(`${displayId}.v1`);
    second.send(wireEvent(makeEvent(makeFrame(protocol, 1, 1), 'resync_required')));
    await flush();
    expect(subscription.getSnapshot().phase).toBe('live');
    expect(send.mock.calls.some((call) => requestUrl(call[0]).includes('/session'))).toBe(false);
  });

  it('bounds freshness by validated server frames, not comments, duplicate data or browser wall clock', async () => {
    const source = stream();
    const send = vi
      .fn<typeof fetch>()
      .mockImplementation((url) =>
        Promise.resolve(
          requestUrl(url).includes('/events?') ? source.response : json(makeFrame(protocol, 1, 1)),
        ),
      );
    const { subscription } = setup(send, protocol);
    source.send(wireEvent(makeEvent(makeFrame(protocol), 'resync_required')));
    await flush();
    vi.setSystemTime(new Date('2040-01-01'));
    source.send(': keep-alive\n\n');
    await flush();
    clock = 15_101;
    await vi.advanceTimersByTimeAsync(250);
    expect(subscription.getSnapshot()).toMatchObject({ phase: 'stale', snapshot: null });
    source.send(wireEvent(makeEvent(makeFrame(protocol, 1, 2))));
    await flush();
    expect(subscription.getSnapshot().phase).toBe('live');
  });

  it('ignores coherent foreign traffic but terminates on a mismatched wire cursor/name without retry', async () => {
    const source = stream();
    const send = vi
      .fn<typeof fetch>()
      .mockImplementation((url) =>
        Promise.resolve(
          requestUrl(url).includes('/events?') ? source.response : json(makeFrame(protocol, 1, 1)),
        ),
      );
    const { subscription } = setup(send, protocol);
    source.send(wireEvent(makeEvent(makeFrame(protocol), 'resync_required')));
    await flush();
    const foreign = makeFrame(protocol, 8, 8);
    foreign.data.id = foreignId;
    source.send(wireEvent(makeEvent(foreign)));
    await flush();
    expect(subscription.getSnapshot().snapshot?.version).toBe(1);
    source.send(
      wireEvent(makeEvent(makeFrame(protocol, 2, 2))).replace(
        'event: overlay.snapshot',
        'event: other',
      ),
    );
    await flush();
    expect(subscription.getSnapshot()).toMatchObject({ phase: 'protocol_error', snapshot: null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(source.cancel).toHaveBeenCalledOnce();
  });
});

it.each([401, 403, 404, 409, 204])(
  'stops on terminal HTTP %s and never changes authority or retries commands',
  async (status) => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        status === 204 ? new Response(null, { status }) : json(errorBody(), status),
      );
    const { subscription } = setup(send);
    await flush();
    expect(subscription.getSnapshot().snapshot).toBeNull();
    expect(subscription.getSnapshot().phase).toBe(
      status === 204 ? 'stopped' : [401, 403].includes(status) ? 'denied' : 'unavailable',
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledOnce();
    expect(JSON.stringify(subscription.getSnapshot())).not.toContain('private-error-marker');
  },
);

it('honors a 429 server retry delay and stops rather than truncating a delay above five minutes', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(errorBody(8), 429))
    .mockResolvedValueOnce(json(errorBody(600), 503));
  const { subscription } = setup(send);
  await flush();
  await vi.advanceTimersByTimeAsync(7999);
  expect(send).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  await flush();
  expect(send).toHaveBeenCalledTimes(2);
  expect(subscription.getSnapshot().phase).toBe('unavailable');
  await vi.advanceTimersByTimeAsync(600_000);
  expect(send).toHaveBeenCalledTimes(2);
});

it('honors the server retry directive without reconnecting earlier than requested', async () => {
  const source = stream(),
    next = stream();
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(source.response)
    .mockResolvedValueOnce(next.response);
  setup(send);
  source.send('retry: 60000\n\n');
  await flush();
  source.end();
  await flush();
  await vi.advanceTimersByTimeAsync(59_999);
  expect(send).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(send).toHaveBeenCalledTimes(2);
});

it('hides stale presentation and releases a silent reader before reconnecting', async () => {
  const source = stream(),
    next = stream();
  let opens = 0;
  const send = vi
    .fn<typeof fetch>()
    .mockImplementation((url) =>
      Promise.resolve(
        requestUrl(url).includes('/events?')
          ? ++opens === 1
            ? source.response
            : next.response
          : json(makeFrame(1, 1, 1)),
      ),
    );
  const { subscription } = setup(send);
  source.send(wireEvent(makeEvent(makeFrame(), 'resync_required')));
  await flush();
  clock = 15_101;
  await vi.advanceTimersByTimeAsync(15_001);
  expect(subscription.getSnapshot().snapshot).toBeNull();
  await vi.advanceTimersByTimeAsync(4999);
  expect(source.cancel).toHaveBeenCalledOnce();
  expect(subscription.getSnapshot().phase).toBe('reconnecting');
  await vi.advanceTimersByTimeAsync(2000);
  expect(opens).toBe(2);
});

it('refetches after a newer gap races an older HTTP snapshot without reconnecting the stream', async () => {
  const source = stream();
  let resolve!: (response: Response) => void,
    reads = 0;
  const send = vi.fn<typeof fetch>().mockImplementation((url) => {
    if (requestUrl(url).includes('/events?')) return Promise.resolve(source.response);
    reads++;
    return reads === 1
      ? new Promise((finish) => {
          resolve = finish;
        })
      : Promise.resolve(json(makeFrame(1, 4, 5)));
  });
  const { subscription } = setup(send);
  source.send(wireEvent(makeEvent(makeFrame(), 'resync_required')));
  await flush();
  source.send(wireEvent(makeEvent(makeFrame(1, 4, 4), 'overlay.changed')));
  await flush();
  resolve(json(makeFrame(1, 1, 1)));
  await flush();
  expect(reads).toBe(2);
  expect(send.mock.calls.filter((call) => requestUrl(call[0]).includes('/events?'))).toHaveLength(
    1,
  );
  expect(subscription.getSnapshot()).toMatchObject({ phase: 'live', snapshot: { version: 4 } });
});

it('aborts/cleans on scope disposal and fences a late snapshot even when a fetcher ignores cancellation', async () => {
  const source = stream();
  let resolve!: (value: Response) => void;
  const send = vi.fn<typeof fetch>().mockImplementation((url) =>
    requestUrl(url).includes('/events?')
      ? Promise.resolve(source.response)
      : new Promise((finish) => {
          resolve = finish;
        }),
  );
  const { scope, subscription } = setup(send);
  source.send(wireEvent(makeEvent(makeFrame(), 'resync_required')));
  await flush();
  scope.dispose();
  resolve(json(makeFrame(1, 1, 1)));
  await flush();
  expect(subscription.getSnapshot()).toMatchObject({ phase: 'stopped', snapshot: null });
  expect(scope.queryClient.getQueryCache().getAll()).toHaveLength(0);
  expect(send.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  expect(source.cancel).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(send).toHaveBeenCalledTimes(2);
});

it('prevents duplicate owners without letting an unstarted subscription release the active owner', () => {
  const source = stream();
  const send = vi.fn<typeof fetch>().mockResolvedValue(source.response);
  const { scope } = setup(send);
  const another = () =>
    createOverlaySubscription({
      origin: 'https://api.example.test',
      displayId,
      grantId,
      protocol: 1,
      scope,
      fetcher: send,
    });
  const second = another();
  expect(() => second.start()).toThrow('already has');
  second.stop();
  const third = another();
  expect(() => third.start()).toThrow('already has');
  third.stop();
});

it.each(['text/html', 'application/json'])(
  'rejects %s success content without treating it as a live stream',
  async (contentType) => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('private-marker', { headers: { 'content-type': contentType } }),
      );
    const { subscription } = setup(send);
    await flush();
    expect(subscription.getSnapshot()).toMatchObject({ phase: 'protocol_error', snapshot: null });
    expect(JSON.stringify(subscription.getSnapshot())).not.toContain('private-marker');
  },
);

it('rejects creator scope/foreign origins/invalid identifiers before any request', () => {
  const scope = createAuthorityScope('creator');
  scopes.push(scope);
  const send = vi.fn<typeof fetch>();
  expect(() => setup(send, 1, scope)).toThrow('authority');
  const overlay = createAuthorityScope('overlay');
  scopes.push(overlay);
  expect(() =>
    createOverlaySubscription({
      origin: 'https://api.example.test/path',
      displayId,
      grantId,
      protocol: 1,
      scope: overlay,
      fetcher: send,
    }),
  ).toThrow();
  expect(() =>
    createOverlaySubscription({
      origin: 'https://api.example.test',
      displayId: 'bad',
      grantId,
      protocol: 1,
      scope: overlay,
      fetcher: send,
    }),
  ).toThrow();
  expect(send).not.toHaveBeenCalled();
});
