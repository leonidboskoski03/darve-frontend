import { afterEach, expect, it, vi } from 'vitest';
import { createCreatorSession, type CreatorSession } from '@/services/creator-session/index';
import { syntheticSupportSession } from './fixture.test-helper';
import { subscribeSupport } from './subscription';
import { ids } from './fixture.test-helper';
const active: CreatorSession[] = [];
const cleanups: (() => void)[] = [];
const flush = async () => {
  for (let n = 0; n < 40; n++) await Promise.resolve();
};
function stream() {
  let output!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller;
    },
    cancel,
  });
  return {
    response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    cancel,
    push: (text: string) => output.enqueue(new TextEncoder().encode(text)),
    end: () => output.close(),
  };
}
const hint = (event = 'resync_required', extra = {}, prefix = '') =>
  prefix +
  `event: ${event}\ndata: ${JSON.stringify({ ticketId: ids.ticket, revision: 1, readSequence: 0, unread: 0, ...extra })}\n\n`;
async function setup(fetcher: typeof fetch) {
  const session = createCreatorSession({
    origin: 'https://api.example.test',
    fetcher: vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(syntheticSupportSession), {
        headers: { 'content-type': 'application/json' },
      }),
    ),
  });
  session.start();
  await session.inspect();
  active.push(session);
  const reset = vi.fn(),
    phase = vi.fn(),
    denied = vi.fn();
  cleanups.push(
    subscribeSupport({
      session,
      ticketId: ids.ticket,
      fetcher,
      onReset: reset,
      onPhase: phase,
      onDenied: denied,
    }),
  );
  await flush();
  return { session, reset, phase, denied };
}
afterEach(() => {
  cleanups.splice(0).forEach((close) => close());
  active.splice(0).forEach((session) => session.stop());
  vi.useRealTimers();
});
it('uses creator cookies without CSRF, replay headers or private hint payload caches', async () => {
  const source = stream(),
    send = vi.fn<typeof fetch>().mockResolvedValue(source.response);
  const { reset, phase } = await setup(send);
  source.push('retry: 500\n\n' + hint());
  await flush();
  expect(phase).toHaveBeenLastCalledWith('live');
  expect(reset).toHaveBeenCalledTimes(2);
  source.push(hint('heartbeat'));
  await flush();
  expect(reset).toHaveBeenCalledTimes(2);
  source.push(hint('changed', { revision: 2 }));
  await flush();
  expect(reset).toHaveBeenCalledTimes(3);
  const [url, options] = send.mock.calls[0]!;
  expect(url).toBe('https://api.example.test/api/support/tickets/' + ids.ticket + '/events');
  expect(options).toMatchObject({
    credentials: 'include',
    referrerPolicy: 'no-referrer',
    redirect: 'error',
    cache: 'no-store',
  });
  expect(new Headers(options?.headers).get('Last-Event-ID')).toBeNull();
  expect(new Headers(options?.headers).get('X-CSRF-Token')).toBeNull();
});
it.each([
  hint('resync_required', { noteUnread: 1 }),
  hint('resync_required', { ticketId: ids.other }),
  hint('resync_required', {}, 'id: unexpected-replay\n'),
  hint('heartbeat'),
  'event: changed\ndata: not-json\n\n',
])('closes invalid or wrong-audience hints without replay', async (frame) => {
  const source = stream(),
    send = vi.fn<typeof fetch>().mockResolvedValue(source.response);
  const { phase } = await setup(send);
  source.push(frame);
  await flush();
  expect(phase).toHaveBeenLastCalledWith('unavailable');
  expect(send).toHaveBeenCalledTimes(1);
  expect(source.cancel).toHaveBeenCalledOnce();
});
it('rejects regressing revisions and fabricated heartbeat changes', async () => {
  const source = stream();
  const { phase } = await setup(vi.fn<typeof fetch>().mockResolvedValue(source.response));
  source.push(hint('resync_required', { revision: 3 }));
  await flush();
  source.push(hint('changed', { revision: 2 }));
  await flush();
  expect(phase).toHaveBeenLastCalledWith('unavailable');
});
it('reconnects only after the server retry interval and starts with fresh HTTP resync', async () => {
  vi.useFakeTimers();
  const first = stream(),
    second = stream();
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(first.response)
    .mockResolvedValueOnce(second.response);
  const { reset } = await setup(send);
  first.push('retry: 2500\n\n' + hint());
  await flush();
  first.end();
  await flush();
  await vi.advanceTimersByTimeAsync(2499);
  expect(send).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(send).toHaveBeenCalledTimes(2);
  second.push(hint());
  await flush();
  expect(reset.mock.calls.length).toBeGreaterThanOrEqual(5);
});
it('clears and cancels live resources on authority disposal', async () => {
  const source = stream();
  const { session, reset } = await setup(vi.fn<typeof fetch>().mockResolvedValue(source.response));
  source.push(hint());
  await flush();
  const before = reset.mock.calls.length;
  session.stop();
  await flush();
  expect(source.cancel).toHaveBeenCalledOnce();
  expect(reset).toHaveBeenCalledTimes(before);
});
it.each([403, 404])('clears denied %s resources and stops connecting', async (status) => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }));
  const { denied } = await setup(send);
  expect(denied).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledOnce();
});
it('bounds repeated unavailability and honors Retry-After', async () => {
  vi.useFakeTimers();
  const send = vi
    .fn<typeof fetch>()
    .mockImplementation(() =>
      Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '2' } })),
    );
  const { phase } = await setup(send);
  await vi.advanceTimersByTimeAsync(1999);
  expect(send).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(40_000);
  expect(send).toHaveBeenCalledTimes(5);
  expect(phase).toHaveBeenLastCalledWith('unavailable');
});
