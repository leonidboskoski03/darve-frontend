import { SessionResponseSchema, parseConsumerResponse } from '@/services/contracts/index';

export type Audience = 'creator' | 'staff' | 'guest' | 'overlay' | 'public';
export type WireSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
};
export type ApiFailure = {
  kind: 'error';
  category:
    'http' | 'protocol' | 'network' | 'cancelled' | 'timeout' | 'authority' | 'configuration';
  action: 'sign_in' | 'denied' | 'not_found' | 'refetch' | 'retry' | 'failed' | 'protocol_error';
  code: string;
  status: number | null;
  requestId: string | null;
  retryAfterSeconds: number | null;
};
export type ApiResult<T> =
  | { kind: 'data' | 'pending'; data: T; status: number }
  | { kind: 'empty'; status: 204 }
  | ApiFailure;
export type JsonRequest<T> = {
  path: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  schema: WireSchema<T>;
  success: readonly (200 | 201 | 202 | 204)[];
  signal?: AbortSignal | undefined;
  idempotencyKey?: string | undefined;
};

export function failure(
  category: ApiFailure['category'],
  code: string,
  status: number | null = null,
): ApiFailure {
  return {
    kind: 'error',
    category,
    code,
    status,
    action: category === 'protocol' ? 'protocol_error' : 'failed',
    requestId: null,
    retryAfterSeconds: null,
  };
}

function allowedPath(audience: Audience, pathname: string) {
  if (audience === 'staff') return pathname.startsWith('/admin/v1/');
  if (!pathname.startsWith('/api/')) return false;
  if (audience === 'guest')
    return /^\/api\/(public\/challenges\/[^/]+\/checkouts|checkouts\/[^/]+(?:\/complete)?)$/.test(
      pathname,
    );
  if (audience === 'overlay') return /^\/api\/overlays\/[^/]+\/(session|snapshot)$/.test(pathname);
  if (audience === 'public') return /^\/api\/public\/challenges\/[^/]+$/.test(pathname);
  return !/^\/api\/(public|checkouts|overlays)(\/|$)/.test(pathname);
}

/** One request, one declared audience/origin. No redirect following, retries or raw error payloads. */
export function createJsonClient(config: {
  origin: string;
  audience: Audience;
  csrf?: (() => string | null) | undefined;
  lifetime?: AbortSignal | undefined;
  fetcher?: typeof fetch | undefined;
  timeoutMs?: number;
}) {
  const origin = new URL(config.origin);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (
    origin.origin !== config.origin ||
    (origin.protocol !== 'https:' && !(loopback && origin.protocol === 'http:')) ||
    origin.username ||
    origin.password
  )
    throw new Error('Invalid API origin configuration.');
  const send = config.fetcher ?? fetch;
  return async function request<T>(input: JsonRequest<T>): Promise<ApiResult<T>> {
    const method = input.method ?? 'GET';
    const path = input.path;
    if (
      !path.startsWith('/') ||
      path.startsWith('//') ||
      /[\\#]|%(?:2e|2f|5c)/i.test(path) ||
      [...path].some((character) => character.charCodeAt(0) <= 32) ||
      path
        .split('?')[0]
        ?.split('/')
        .some((part) => part === '.' || part === '..')
    )
      return failure('configuration', 'INVALID_API_PATH');
    const url = new URL(path, origin);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return failure('configuration', 'INVALID_API_PATH');
    }
    if (
      url.origin !== origin.origin ||
      !allowedPath(config.audience, pathname) ||
      (method !== 'GET' && config.audience === 'public')
    )
      return failure('configuration', 'INVALID_API_PATH');
    if (method === 'GET' && input.body !== undefined)
      return failure('configuration', 'INVALID_REQUEST_BODY');
    if (input.success.length === 0 || input.success.some((s) => ![200, 201, 202, 204].includes(s)))
      return failure('configuration', 'INVALID_SUCCESS_POLICY');
    const headers = new Headers({ Accept: 'application/json' });
    const mutation = method !== 'GET';
    const signIn =
      config.audience === 'creator' &&
      method === 'POST' &&
      /^\/api\/auth\/(twitch|youtube|kick)\/start$/.test(url.pathname) &&
      typeof input.body === 'object' &&
      input.body !== null &&
      'intent' in input.body &&
      input.body.intent === 'sign_in';
    if (mutation && ['creator', 'staff'].includes(config.audience) && !signIn) {
      const csrf = config.csrf?.();
      if (!csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf)) return failure('authority', 'CSRF_REQUIRED');
      headers.set(config.audience === 'staff' ? 'x-staff-csrf' : 'X-CSRF-Token', csrf);
    }
    if (input.idempotencyKey !== undefined) {
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey))
        return failure('configuration', 'INVALID_IDEMPOTENCY_KEY');
      headers.set('Idempotency-Key', input.idempotencyKey);
    }
    const timeout = AbortSignal.timeout(config.timeoutMs ?? 15000);
    const signal = AbortSignal.any([
      timeout,
      ...[config.lifetime, input.signal].filter((s): s is AbortSignal => Boolean(s)),
    ]);
    let body: string | undefined;
    try {
      if (input.body !== undefined) {
        body = JSON.stringify(input.body);
        headers.set('Content-Type', 'application/json');
      }
      signal.throwIfAborted();
      const response = await send(url.href, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal,
        credentials: config.audience === 'public' ? 'omit' : 'include',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (response.redirected || response.type === 'opaqueredirect')
        return failure('protocol', 'UNEXPECTED_REDIRECT');
      const text = await response.text();
      signal.throwIfAborted();
      if (text.length > 2_000_000)
        return failure('protocol', 'RESPONSE_TOO_LARGE', response.status);
      if (response.status >= 400) {
        // The pinned helper validates safe error metadata; its success/202 branch is not used here.
        const result = parseConsumerResponse(
          {
            status: response.status,
            contentType: response.headers.get('content-type'),
            bodyText: text,
          },
          SessionResponseSchema,
        );
        if (result.kind !== 'error')
          return failure('protocol', 'INVALID_RESPONSE', response.status);
        return { ...result, category: result.action === 'protocol_error' ? 'protocol' : 'http' };
      }
      if (!input.success.includes(response.status as 200 | 201 | 202 | 204))
        return failure('protocol', 'UNEXPECTED_STATUS', response.status);
      if (response.status === 204)
        return text === ''
          ? { kind: 'empty', status: 204 }
          : failure('protocol', 'INVALID_EMPTY_RESPONSE', 204);
      if (
        response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
        'application/json'
      )
        return failure('protocol', 'INVALID_RESPONSE', response.status);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return failure('protocol', 'INVALID_RESPONSE', response.status);
      }
      const parsed = input.schema.safeParse(json);
      if (!parsed.success) return failure('protocol', 'INVALID_RESPONSE', response.status);
      return {
        kind: response.status === 202 ? 'pending' : 'data',
        data: parsed.data,
        status: response.status,
      };
    } catch {
      if (config.lifetime?.aborted || input.signal?.aborted)
        return failure('cancelled', 'REQUEST_CANCELLED');
      if (timeout.aborted) return failure('timeout', 'REQUEST_TIMEOUT');
      if (signal.aborted) return failure('cancelled', 'REQUEST_CANCELLED');
      return failure('network', 'REQUEST_UNCONFIRMED');
    }
  };
}
