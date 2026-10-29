import { describe, expect, it, vi } from 'vitest';
import { SessionResponseSchema } from '@/services/contracts/index';
import { createJsonClient } from './json-client';

const body = { authenticated: false, user: null, expiresAt: null, csrfToken: null };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const read = { path: '/api/session', schema: SessionResponseSchema, success: [200] as const };

describe('credentialed JSON transport', () => {
  it('pins origin, credentials, redirect/referrer/cache policy and omits a GET body', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(json(body));
    const client = createJsonClient({
      origin: 'https://api.example.test',
      audience: 'creator',
      fetcher: send,
    });
    expect(await client(read)).toMatchObject({ kind: 'data', data: body });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe('https://api.example.test/api/session');
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'include',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      method: 'GET',
    });
    expect(send.mock.calls[0]?.[1]).not.toHaveProperty('body');
  });

  it.each([
    'https://evil.test/api/session',
    '//evil.test/api/session',
    '/admin/v1/session',
    '/api/../admin/v1/session',
    '/api/%2e%2e/admin/v1/session',
    '/api%2fsession?timeZone=Europe%2FWarsaw',
    '/api/%5cadmin?timeZone=Europe%2FWarsaw',
    '/api/checkouts/123',
    '/api/%63heckouts/123',
    '/api/overlays/123/snapshot',
    '/api/session#proof',
  ])('rejects escaped or foreign-authority path %s without sending', async (path) => {
    const send = vi.fn<typeof fetch>();
    const client = createJsonClient({
      origin: 'https://api.example.test',
      audience: 'creator',
      fetcher: send,
    });
    expect(await client({ ...read, path })).toMatchObject({ category: 'configuration' });
    expect(send).not.toHaveBeenCalled();
  });

  it('permits an encoded timezone query without changing origin or pathname authority', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(json(body));
    const client = createJsonClient({
      origin: 'https://api.example.test',
      audience: 'creator',
      fetcher: send,
    });
    expect(await client({ ...read, path: '/api/session?timeZone=Europe%2FWarsaw' })).toMatchObject({
      kind: 'data',
    });
    expect(send.mock.calls[0]?.[0]).toBe(
      'https://api.example.test/api/session?timeZone=Europe%2FWarsaw',
    );
    expect(send.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it('requires creator CSRF, preserves an idempotency key and sends an actually empty logout body', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    let proof: string | null = null;
    const client = createJsonClient({
      origin: 'https://api.example.test',
      audience: 'creator',
      csrf: () => proof,
      fetcher: send,
    });
    const command = {
      ...read,
      path: '/api/session/logout',
      method: 'POST' as const,
      success: [204] as const,
    };
    expect(await client(command)).toMatchObject({ code: 'CSRF_REQUIRED' });
    expect(send).not.toHaveBeenCalled();
    proof = 'a'.repeat(43);
    expect(await client({ ...command, idempotencyKey: 'intent-1234567890' })).toEqual({
      kind: 'empty',
      status: 204,
    });
    const init = send.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe(proof);
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('intent-1234567890');
    expect(init).not.toHaveProperty('body');
  });

  it('validates explicit pending 202 without rewriting its status or treating it as completion', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(json(body, 202)));
    const client = createJsonClient({
      origin: 'https://api.example.test',
      audience: 'creator',
      fetcher: send,
    });
    expect(await client(read)).toMatchObject({ category: 'protocol', status: 202 });
    expect(await client({ ...read, success: [202] })).toEqual({
      kind: 'pending',
      status: 202,
      data: body,
    });
  });

  it.each([
    [new Response('<private>', { headers: { 'content-type': 'text/html' } }), 'INVALID_RESPONSE'],
    [
      new Response('invalid-private-json', { headers: { 'content-type': 'application/json' } }),
      'INVALID_RESPONSE',
    ],
    [json({ secret: 'private-marker' }), 'INVALID_RESPONSE'],
    [
      new Response(null, { status: 302, headers: { Location: 'https://evil.test' } }),
      'UNEXPECTED_STATUS',
    ],
  ])('rejects unexpected response representations safely', async (response, code) => {
    const client = createJsonClient({
      origin: 'https://api.example.test',
      audience: 'creator',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response),
    });
    const result = await client(read);
    expect(result).toMatchObject({ kind: 'error', category: 'protocol', code });
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('does not replay a failed mutation or retain its raw network error', async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error('private-provider-payload'));
    const client = createJsonClient({
      origin: 'https://api.example.test',
      audience: 'creator',
      csrf: () => 'a'.repeat(43),
      fetcher: send,
    });
    const result = await client({
      ...read,
      method: 'POST',
      path: '/api/session/logout',
      success: [204],
    });
    expect(result).toMatchObject({ category: 'network', code: 'REQUEST_UNCONFIRMED' });
    expect(send).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('rejects a late response when its lifetime was cancelled even if the fetcher ignored AbortSignal', async () => {
    const lifetime = new AbortController();
    let resolve!: (response: Response) => void;
    const send = vi.fn<typeof fetch>().mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const client = createJsonClient({
      origin: 'https://api.example.test',
      audience: 'creator',
      lifetime: lifetime.signal,
      fetcher: send,
    });
    const task = client(read);
    lifetime.abort();
    resolve(json(body));
    expect(await task).toMatchObject({ category: 'cancelled' });
  });

  it('keeps public/guest/staff/overlay namespaces and staff CSRF independent', async () => {
    for (const audience of ['public', 'guest', 'staff', 'overlay'] as const) {
      const send = vi.fn<typeof fetch>();
      const client = createJsonClient({
        origin: 'https://api.example.test',
        audience,
        fetcher: send,
      });
      expect(await client(read)).toMatchObject({ category: 'configuration' });
      expect(send).not.toHaveBeenCalled();
    }
    const send = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(json(body)));
    const staff = createJsonClient({
      origin: 'https://staff.example.test',
      audience: 'staff',
      csrf: () => 'b'.repeat(43),
      fetcher: send,
    });
    await staff({ ...read, path: '/admin/v1/session/logout', method: 'POST', body: {} });
    const headers = new Headers(send.mock.calls[0]?.[1]?.headers);
    expect(headers.get('x-staff-csrf')).toBe('b'.repeat(43));
    expect(headers.has('X-CSRF-Token')).toBe(false);
  });
  it.each([
    [403, 'denied'],
    [404, 'not_found'],
    [409, 'refetch'],
    [429, 'retry'],
    [503, 'retry'],
  ] as const)(
    'preserves safe %s error semantics without exposing backend messages',
    async (status, action) => {
      const response = json(
        {
          schemaVersion: 1,
          serverTime: '2026-10-27T12:00:00.000Z',
          error: {
            code: 'SAFE_CODE',
            message: 'private-body-marker',
            requestId: 'synthetic-request',
            retryable: status === 429 || status === 503,
            retryAfterSeconds: status === 429 || status === 503 ? 2 : null,
            issues: [],
            refetch: null,
          },
        },
        status,
      );
      const send = vi.fn<typeof fetch>().mockResolvedValue(response);
      const result = await createJsonClient({
        origin: 'https://api.example.test',
        audience: 'creator',
        fetcher: send,
      })(read);
      expect(result).toMatchObject({
        kind: 'error',
        action,
        status,
        requestId: 'synthetic-request',
      });
      expect(JSON.stringify(result)).not.toContain('private-body-marker');
      expect(send).toHaveBeenCalledOnce();
    },
  );
  it('distinguishes timeout from caller cancellation without replaying', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    const client = createJsonClient({
      origin: 'https://api.example.test',
      audience: 'creator',
      fetcher: send,
      timeoutMs: 10,
    });
    expect(await client(read)).toMatchObject({ category: 'timeout', code: 'REQUEST_TIMEOUT' });
    expect(send).toHaveBeenCalledOnce();
    const cancelled = new AbortController();
    cancelled.abort();
    expect(await client({ ...read, signal: cancelled.signal })).toMatchObject({
      category: 'cancelled',
    });
    expect(send).toHaveBeenCalledOnce();
  });
});
