import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthorityScope, type AuthorityScope } from '@/services/server-state/index';
import { createAnalysisLiveSubscription } from './analysis-live-subscription';
import {
  idea,
  preview,
  publishedEvent,
  roundId,
  state,
  supporters,
  wire,
} from './analysis-live.test-support';

const encoder = new TextEncoder();
const origin = 'https://api.example.test';
function stream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  return {
    response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
}
const errorResponse = (status: number) =>
  new Response(
    JSON.stringify({
      schemaVersion: 1,
      serverTime: '2026-11-15T12:00:00.000Z',
      error: {
        code: 'NOT_FOUND',
        message: 'private-error-marker',
        requestId: 'synthetic-request',
        retryable: false,
        retryAfterSeconds: null,
        issues: [],
        refetch: null,
      },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
const flush = async () => {
  for (let count = 0; count < 40; count++) await Promise.resolve();
};
const scopes: AuthorityScope[] = [];
function setup(send: typeof fetch, scope = createAuthorityScope('creator')) {
  scopes.push(scope);
  const subscription = createAnalysisLiveSubscription({
    origin,
    roundId,
    scope,
    fetcher: send,
    random: () => 0,
  });
  subscription.start();
  return subscription;
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  scopes.forEach((scope) => scope.dispose());
  scopes.length = 0;
  vi.useRealTimers();
});

describe('creator analysis live stream', () => {
  it('reads the creator stream with the session cookie and applies the preview', async () => {
    const source = stream();
    const send = vi.fn<typeof fetch>().mockResolvedValue(source.response);
    const subscription = setup(send);
    source.send(wire(state('open')) + wire(preview(idea(1), idea(2))));
    await flush();
    expect(subscription.getSnapshot()).toMatchObject({
      phase: 'live',
      roundState: 'open',
      preview: [{ order: 1 }, { order: 2 }],
    });
    expect(send.mock.calls[0]?.[0]).toBe(`${origin}/api/rounds/${roundId}/analysis/events`);
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      credentials: 'include',
      redirect: 'error',
      cache: 'no-store',
    });
  });

  it('resumes with Last-Event-ID after the server rotates the connection', async () => {
    const first = stream(),
      second = stream();
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(second.response);
    const subscription = setup(send);
    const cursor = 'c'.repeat(64);
    first.send(wire(preview(idea(1)), cursor));
    await flush();
    first.end();
    await flush();
    expect(subscription.getSnapshot().phase).toBe('reconnecting');
    expect(subscription.getSnapshot().preview).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2500);
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(new Headers(send.mock.calls[1]?.[1]?.headers).get('Last-Event-ID')).toBe(cursor);
  });

  it('stops after the published result has settled', async () => {
    const source = stream();
    const send = vi.fn<typeof fetch>().mockResolvedValue(source.response);
    const subscription = setup(send);
    source.send(wire(state('published')) + wire(publishedEvent(true)));
    await flush();
    expect(subscription.getSnapshot()).toMatchObject({ phase: 'live', result: { settling: true } });
    source.send(wire(supporters(false)));
    await flush();
    expect(subscription.getSnapshot()).toMatchObject({
      phase: 'finished',
      result: { settling: false, suggestions: [{ supporterCount: 41 }, {}, {}] },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not retry an unknown round or another creator round', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(errorResponse(404));
    const subscription = setup(send);
    await flush();
    expect(subscription.getSnapshot().phase).toBe('unavailable');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('treats invalid or foreign frames as a protocol error', async () => {
    const source = stream();
    const subscription = setup(vi.fn<typeof fetch>().mockResolvedValue(source.response));
    source.send(wire({ ...preview(idea(1)), roundId: '40000000-0000-4000-8000-000000000004' }));
    await flush();
    expect(subscription.getSnapshot().phase).toBe('protocol_error');
  });

  it('rejects a frame whose event name does not match its type', async () => {
    const source = stream();
    const subscription = setup(vi.fn<typeof fetch>().mockResolvedValue(source.response));
    source.send(wire(preview(idea(1))).replace('event: preview', 'event: published'));
    await flush();
    expect(subscription.getSnapshot().phase).toBe('protocol_error');
  });

  it('refuses non-creator authority', () => {
    const scope = createAuthorityScope('overlay');
    scopes.push(scope);
    expect(() =>
      createAnalysisLiveSubscription({ origin, roundId, scope, fetcher: vi.fn() }),
    ).toThrow();
  });
});
