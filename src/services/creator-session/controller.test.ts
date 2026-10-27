import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCreatorSession } from './controller';
import { SessionResponseSchema } from '@/services/contracts/index';
import { createAuthorityScope } from '@/services/server-state/index';

const signedOut = { authenticated: false, user: null, expiresAt: null, csrfToken: null };
const signedIn = {
  authenticated: true,
  user: {
    id: '11223344-1234-4234-8234-112233445566',
    displayName: 'Synthetic creator',
    termsStatus: {
      status: 'unconfigured',
      requiredVersion: null,
      acceptedVersion: null,
      acceptedAt: null,
    },
  },
  expiresAt: '2030-01-01T00:00:00.000Z',
  csrfToken: 'a'.repeat(43),
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const active: ReturnType<typeof createCreatorSession>[] = [];
function setup(send: typeof fetch) {
  const session = createCreatorSession({ origin: 'https://api.example.test', fetcher: send });
  active.push(session);
  session.start();
  return session;
}
afterEach(() => {
  active.forEach((session) => session.stop());
  active.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('creator authority lifecycle', () => {
  it('establishes a real parsed session with proof outside Query data, and clears all private state before logout completes', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(json(signedIn));
    const session = setup(send);
    await session.inspect();
    expect(session.getSnapshot().phase).toBe('authenticated');
    expect(
      JSON.stringify(session.getSnapshot().scope.queryClient.getQueryCache().getAll()),
    ).not.toContain(signedIn.csrfToken);
    const old = session.getSnapshot().scope;
    old.queryClient.setQueryData(old.key(['private']), { text: 'private-marker' });
    const cleanup = vi.fn();
    old.onDispose(cleanup);
    let finish!: (response: Response) => void;
    send.mockReturnValueOnce(
      new Promise((r) => {
        finish = r;
      }),
    );
    const task = session.logout();
    expect(old.signal.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(old.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(session.getSnapshot().user).toBeNull();
    finish(new Response(null, { status: 204 }));
    await task;
    expect(session.getSnapshot().phase).toBe('signed_out');
    expect(new Headers(send.mock.calls[1]?.[1]?.headers).get('X-CSRF-Token')).toBe(
      signedIn.csrfToken,
    );
  });

  it('prevents a stale authenticated inspection from reviving a stopped/new generation', async () => {
    let finish!: (response: Response) => void;
    const send = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(
        new Promise((r) => {
          finish = r;
        }),
      )
      .mockImplementation(() => Promise.resolve(json(signedOut)));
    const session = setup(send);
    session.stop();
    session.start();
    await session.inspect();
    const current = session.getSnapshot().scope;
    finish(json(signedIn));
    await Promise.resolve();
    await Promise.resolve();
    expect(session.getSnapshot().phase).toBe('signed_out');
    expect(session.getSnapshot().scope).toBe(current);
  });

  it('expires locally and rejects further private requests without sending', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2029-12-31T23:59:59.000Z'));
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(json(signedIn));
    const session = setup(send);
    await session.inspect();
    const old = session.getSnapshot().scope;
    vi.advanceTimersByTime(1100);
    expect(session.getSnapshot().phase).toBe('expired');
    expect(old.signal.aborted).toBe(true);
    expect(
      await session.request({
        path: '/api/profile',
        schema: SessionResponseSchema,
        success: [200],
      }),
    ).toMatchObject({ category: 'authority' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('supersedes an in-flight inspection when another tab confirms sign-out', async () => {
    const channels: { onmessage: ((event: MessageEvent<unknown>) => void) | null }[] = [];
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
        close = vi.fn();
        postMessage = vi.fn();
        constructor() {
          channels.push(this);
        }
      },
    );
    let finish!: (response: Response) => void;
    const send = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValueOnce(json(signedOut));
    const session = setup(send);
    const old = session.getSnapshot().scope;
    const oldInspection = session.inspect();
    channels[0]?.onmessage?.(new MessageEvent('message', { data: 'invalidate' }));
    await session.inspect();
    expect(old.signal.aborted).toBe(true);
    finish(json(signedIn));
    await oldInspection;
    expect(session.getSnapshot().phase).toBe('signed_out');
    expect(session.getSnapshot().user).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps an unconfirmed logout blocked with no automatic replay or focus re-entry', async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(signedIn))
      .mockRejectedValueOnce(new Error('offline'));
    const session = setup(send);
    await session.inspect();
    await session.logout();
    expect(session.getSnapshot().phase).toBe('logout_unconfirmed');
    window.dispatchEvent(new Event('focus'));
    await session.inspect();
    expect(send).toHaveBeenCalledTimes(2);
    send.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await session.logout();
    expect(session.getSnapshot().phase).toBe('signed_out');
  });

  it('clears authority on a real 401 but preserves denied/conflict distinctions', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(json(signedIn));
    const session = setup(send);
    await session.inspect();
    const old = session.getSnapshot().scope;
    send.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          serverTime: '2026-10-27T12:00:00.000Z',
          error: {
            code: 'SESSION_REQUIRED',
            message: 'private-marker',
            requestId: 'request-123',
            retryable: false,
            retryAfterSeconds: null,
            issues: [],
            refetch: null,
          },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await session.request({
      path: '/api/profile',
      schema: SessionResponseSchema,
      success: [200],
    });
    expect(result).toMatchObject({ status: 401, category: 'http', action: 'sign_in' });
    expect(session.getSnapshot().phase).toBe('expired');
    expect(old.signal.aborted).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-marker');
  });
});

it('fences late Query results and isolates creator/staff/guest/overlay caches', async () => {
  const scopes = ['creator', 'staff', 'guest', 'overlay'].map((audience) =>
    createAuthorityScope(audience as 'creator' | 'staff' | 'guest' | 'overlay'),
  );
  const old = scopes[0]!;
  let finish!: (value: string) => void;
  const result = old.query(
    ['private'],
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const rejected = expect(result).rejects.toBeDefined();
  old.dispose();
  finish('old-private-value');
  await rejected;
  expect(scopes.every((s) => s.queryClient.getQueryCache().getAll().length === 0)).toBe(true);
  scopes.forEach((s) => s.dispose());
});
