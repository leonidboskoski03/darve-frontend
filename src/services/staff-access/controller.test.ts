import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStaffAccess, type StaffAccess } from './controller';
import { readStaffEntry, isStaffAuthorizationUrl, staffReviewSearch } from './location';
import { parseStaffEnvironment } from '@/services/config/index';

const origin = 'https://staff.example.test';
const endpoint = 'https://identity.example.test/authorize';
const proof = 'a'.repeat(43);
const address = (input: RequestInfo | URL | undefined) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : (input?.url ?? '');
const member = { id: '12345678-1234-4234-8234-123456789012', role: 'SUPPORT', revision: 1 };
const expires = () => new Date(Date.now() + 120000).toISOString();
const authenticated = () => ({
  state: 'authenticated',
  staff: member,
  permissions: ['tickets.reply'],
  expiresAt: expires(),
  authenticatedAt: new Date().toISOString(),
  csrfToken: proof,
});
const enrollment = () => ({
  state: 'enrollment_pending',
  role: 'SUPPORT',
  expiresAt: expires(),
  csrfToken: proof,
});
const codePending = () => ({ state: 'email_code_pending', expiresAt: expires(), csrfToken: proof });
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ schemaVersion: 1, serverTime: new Date().toISOString(), data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const error = (status: number, code = 'UNAUTHENTICATED', retryAfterSeconds: number | null = null) =>
  new Response(
    JSON.stringify({
      schemaVersion: 1,
      serverTime: new Date().toISOString(),
      error: {
        code,
        message: 'private-marker',
        requestId: 'synthetic',
        retryable: status === 429,
        retryAfterSeconds,
        issues: [],
        refetch: null,
      },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
function authorization() {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries({
    state: proof,
    nonce: proof,
    code_challenge: proof,
    response_type: 'code',
    redirect_uri: origin + '/admin/v1/auth/callback',
    code_challenge_method: 'S256',
    prompt: 'login',
    max_age: '0',
  }))
    url.searchParams.set(key, value);
  return url.href;
}
const instances: StaffAccess[] = [];
afterEach(() => {
  instances.forEach((value) => value.stop());
  instances.length = 0;
  vi.useRealTimers();
  window.sessionStorage.removeItem('darve.staff.signout-pending.v1');
});
function fixture(
  initial: unknown = { state: 'signed_out' },
  pending: unknown = null,
  invitation: string | null = null,
) {
  const state = { session: initial, pending, authorizationUrl: authorization() };
  const send = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    await Promise.resolve();
    const path = new URL(address(input)).pathname;
    if (init?.method === 'GET')
      return path.endsWith('/email-code')
        ? state.pending
          ? json(state.pending)
          : error(401)
        : json(state.session);
    if (path.endsWith('/start') || path.endsWith('/step-up'))
      return json({ authorizationUrl: state.authorizationUrl });
    if (path.endsWith('/verify')) {
      state.pending = null;
      state.session = enrollment();
      return json({ state: 'enrollment_pending', returnPath: '/staff/enrol' });
    }
    if (path.endsWith('/accept')) {
      state.session = authenticated();
      return json({ accepted: true });
    }
    if (path.endsWith('/resend')) return json({ sent: true });
    if (path.endsWith('/cancel')) {
      state.pending = null;
      return json({ cancelled: true });
    }
    if (path.endsWith('/logout')) {
      state.session = { state: 'signed_out' };
      return json({ signedOut: true });
    }
    throw Error('Unexpected fixture request');
  });
  const navigate = vi.fn(),
    navigateReturn = vi.fn();
  const access = createStaffAccess({
    origin,
    authorizationEndpoint: endpoint,
    frontendOrigin: origin,
    fetcher: send,
    invitation,
    navigate,
    navigateReturn,
  });
  instances.push(access);
  return {
    state,
    send,
    access,
    navigate,
    navigateReturn,
    async start() {
      access.start();
      await access.inspect();
    },
  };
}
describe('independent staff authority lifecycle', () => {
  it('clears stale authority after rejected step-up and never retries it automatically', async () => {
    for (const status of [401, 403]) {
      const f = fixture(authenticated());
      await f.start();
      const old = f.access.getSnapshot().scope;
      f.state.session = { state: 'signed_out' };
      f.send.mockResolvedValueOnce(error(status));
      await f.access.stepUp();
      expect(f.access.getSnapshot().phase).toBe('signed_out');
      expect(f.access.getSnapshot().staff).toBeNull();
      expect(old.signal.aborted).toBe(true);
      expect(f.navigate).not.toHaveBeenCalled();
      expect(f.send.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    }
  });
  it('a pending-signout marker cannot manufacture authority or block a fresh enrollment after the session is gone', async () => {
    window.sessionStorage.setItem('darve.staff.signout-pending.v1', '1');
    const f = fixture(enrollment());
    await f.start();
    expect(f.access.getSnapshot().phase).toBe('enrollment_pending');
    expect(f.access.getSnapshot().staff).toBeNull();
    expect(window.sessionStorage.getItem('darve.staff.signout-pending.v1')).toBeNull();
  });
  it('disposes the authority and clears published private state when stopped', async () => {
    const f = fixture(authenticated());
    await f.start();
    const scope = f.access.getSnapshot().scope;
    f.access.stop();
    expect(scope.signal.aborted).toBe(true);
    expect(f.access.getSnapshot().staff).toBeNull();
    expect(f.access.getSnapshot().permissions).toEqual([]);
  });
  it('retains only a content-free uncertain sign-out intent across a new lifetime', async () => {
    const first = fixture(authenticated());
    await first.start();
    first.send.mockRejectedValueOnce(new Error('response lost'));
    await first.access.logout();
    expect(window.sessionStorage.getItem('darve.staff.signout-pending.v1')).toBe('1');
    first.access.stop();
    const next = fixture(authenticated());
    await next.start();
    expect(next.access.getSnapshot().phase).toBe('logout_unconfirmed');
    expect(next.access.getSnapshot().staff).toBeNull();
    await next.access.logout();
    expect(next.access.getSnapshot().phase).toBe('signed_out');
    expect(window.sessionStorage.getItem('darve.staff.signout-pending.v1')).toBeNull();
  });
  it('serves the backend pending-code landing path independently of allowed final return paths', () => {
    expect(readStaffEntry(origin + '/staff/verify-email?code=untrusted').path).toBe(
      '/staff/verify-email',
    );
  });
  it('preserves only reviewed staff-tool filters while stripping proofs, duplicates and invalid targets', () => {
    const id = '12345678-1234-4234-8234-123456789012';
    expect(
      staffReviewSearch('?view=challenge&id=' + id + '&token=private&invitation=private'),
    ).toBe('?view=challenge&id=' + id);
    expect(
      staffReviewSearch(
        '?view=staff&view=audit&id=invalid&owner=invalid&state=untrusted&csrf=private',
      ),
    ).toBe('');
    expect(staffReviewSearch('?view=reviews&owner=' + id + '&state=in_review')).toBe(
      '?view=reviews&owner=' + id + '&state=in_review',
    );
    expect(staffReviewSearch('?view=reviews&extra=' + 'x'.repeat(2100))).toBe('');
  });
  it('requires a matched hostname and complete public configuration, without leaking values', () => {
    expect(
      parseStaffEnvironment({
        STAFF_PUBLIC_APP_ENV: 'local',
        STAFF_PUBLIC_API_ORIGIN: 'http://localhost:3320',
        STAFF_PUBLIC_AUTHORIZATION_ENDPOINT: 'https://identity.example.test/authorize',
      }).apiOrigin,
    ).toBe('http://localhost:3320');
    for (const values of [
      { STAFF_PUBLIC_SECRET: 'private-marker' },
      { STAFF_PUBLIC_API_ORIGIN: origin },
      {
        STAFF_PUBLIC_APP_ENV: 'production',
        STAFF_PUBLIC_API_ORIGIN: 'http://localhost:3320',
        STAFF_PUBLIC_AUTHORIZATION_ENDPOINT: endpoint,
      },
    ])
      expect(() => parseStaffEnvironment(values)).toThrow('Invalid staff public configuration');
    const send = vi.fn<typeof fetch>();
    const access = createStaffAccess({
      origin,
      authorizationEndpoint: endpoint,
      frontendOrigin: 'https://creator.example.test',
      fetcher: send,
    });
    instances.push(access);
    access.start();
    expect(access.getSnapshot().phase).toBe('unconfigured');
    expect(send).not.toHaveBeenCalled();
  });
  it('captures only exact one-use invitation fragments and pins provider/callback/PKCE navigation', () => {
    expect(readStaffEntry(origin + '/staff/enrol#invitation=' + proof).invitation).toBe(proof);
    for (const path of [
      '/#invitation=' + proof,
      '/staff/enrol?code=private#invitation=' + proof,
      '/staff/enrol#invitation=' + proof + '&invitation=' + proof,
      '/staff/enrol#invitation=bad',
    ])
      expect(readStaffEntry(origin + path).invitation).toBeNull();
    expect(isStaffAuthorizationUrl(authorization(), endpoint, origin)).toBe(true);
    for (const value of [
      authorization().replace('identity.example.test', 'foreign.example.test'),
      authorization() + '#private',
      authorization().replace('S256', 'plain'),
      authorization() + '&state=' + proof,
      authorization().replace('prompt=login', 'prompt=none'),
    ])
      expect(isStaffAuthorizationUrl(value, endpoint, origin)).toBe(false);
  });
  it('coalesces status reads and sends signed-out start once with no creator proof', async () => {
    const f = fixture(undefined, null, proof);
    await f.start();
    expect(f.send).toHaveBeenCalledTimes(2);
    await Promise.all([f.access.signIn(), f.access.signIn()]);
    expect(f.send).toHaveBeenCalledTimes(3);
    const init = f.send.mock.calls[2]?.[1];
    expect(new Headers(init?.headers).has('x-staff-csrf')).toBe(false);
    expect(new Headers(init?.headers).has('X-CSRF-Token')).toBe(false);
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : '') as unknown).toMatchObject({
      invitationSecret: proof,
    });
    expect(f.navigate).toHaveBeenCalledOnce();
    expect(f.access.getSnapshot().phase).toBe('redirecting');
    expect(f.access.getSnapshot().invitationAvailable).toBe(false);
  });
  it('never navigates to an unpinned authorization response', async () => {
    const f = fixture();
    f.state.authorizationUrl = 'https://foreign.example.test/authorize';
    await f.start();
    await f.access.signIn();
    expect(f.navigate).not.toHaveBeenCalled();
    expect(f.access.getSnapshot().error?.code).toBe('INVALID_STAFF_AUTHORIZATION');
  });
  it('separates pending code, enrollment and membership; accepts only after explicit confirmation', async () => {
    const f = fixture(undefined, codePending());
    await f.start();
    expect(f.access.getSnapshot().phase).toBe('email_code_pending');
    await f.access.verify('00001234');
    expect(f.access.getSnapshot().phase).toBe('enrollment_pending');
    expect(f.access.getSnapshot().staff).toBeNull();
    const count = f.send.mock.calls.length;
    await f.access.accept(false);
    expect(f.send).toHaveBeenCalledTimes(count);
    await f.access.accept(true);
    expect(f.access.getSnapshot().phase).toBe('authenticated');
    expect(f.access.getSnapshot().role).toBe('SUPPORT');
    expect(f.navigateReturn).toHaveBeenLastCalledWith('/');
    const write = f.send.mock.calls.find(([input]) => address(input).endsWith('/verify'))?.[1];
    expect(new Headers(write?.headers).get('x-staff-csrf')).toBe(proof);
    expect(new Headers(write?.headers).has('X-CSRF-Token')).toBe(false);
    expect(f.access.getSnapshot()).not.toHaveProperty('csrfToken');
  });
  it('requires canonical session proof after a successful verification acknowledgement', async () => {
    const f = fixture(undefined, codePending());
    await f.start();
    f.send.mockImplementationOnce(() => {
      f.state.pending = null;
      return Promise.resolve(json({ state: 'authenticated', returnPath: '/reviews' }));
    });
    await f.access.verify('00001234');
    expect(f.access.getSnapshot().phase).toBe('unavailable');
    expect(f.navigateReturn).not.toHaveBeenCalled();
  });
  it('keeps a rejected code pending only when fresh server status still confirms it', async () => {
    const f = fixture(undefined, codePending());
    await f.start();
    f.send.mockResolvedValueOnce(error(401));
    await f.access.verify('00001234');
    expect(f.access.getSnapshot().phase).toBe('email_code_pending');
    expect(f.access.getSnapshot().error?.status).toBe(401);
    f.state.pending = null;
    await f.access.inspect();
    expect(f.access.getSnapshot().phase).toBe('signed_out');
  });
  it('holds unknown logout closed even if a status read still shows the old session, then permits deliberate retry', async () => {
    const f = fixture(authenticated());
    await f.start();
    const scope = f.access.getSnapshot().scope;
    scope.queryClient.setQueryData(scope.key(['private']), { body: 'private-marker' });
    f.send.mockRejectedValueOnce(new Error('response lost'));
    await f.access.logout();
    expect(f.access.getSnapshot().phase).toBe('logout_unconfirmed');
    expect(f.access.getSnapshot().staff).toBeNull();
    expect(scope.queryClient.getQueryData(scope.key(['private']))).toBeUndefined();
    await f.access.inspect();
    expect(f.access.getSnapshot().phase).toBe('logout_unconfirmed');
    await f.access.logout();
    expect(f.access.getSnapshot().phase).toBe('signed_out');
  });
  it('uses recent-assurance step-up with the staff proof and never replays an application command', async () => {
    const f = fixture(authenticated());
    await f.start();
    await f.access.stepUp();
    const writes = f.send.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(address(writes[0]?.[0]).endsWith('/admin/v1/auth/step-up')).toBe(true);
    expect(new Headers(writes[0]?.[1]?.headers).get('x-staff-csrf')).toBe(proof);
    expect(f.navigate).toHaveBeenCalledOnce();
    expect(f.access.getSnapshot().staff).toBeNull();
  });
  it('clears authority/cache on server-relative expiry and refuses commands afterwards', async () => {
    vi.useFakeTimers();
    const f = fixture({ ...authenticated(), expiresAt: new Date(Date.now() + 1000).toISOString() });
    await f.start();
    const scope = f.access.getSnapshot().scope;
    scope.queryClient.setQueryData(scope.key(['notes']), 'private-marker');
    await vi.advanceTimersByTimeAsync(1001);
    expect(f.access.getSnapshot().phase).toBe('expired');
    expect(scope.signal.aborted).toBe(true);
    expect(scope.queryClient.getQueryData(scope.key(['notes']))).toBeUndefined();
    const count = f.send.mock.calls.length;
    await f.access.stepUp();
    expect(f.send).toHaveBeenCalledTimes(count);
  });
  it('ignores a late response from an invalidated lifetime and permits fresh status inspection', async () => {
    const f = fixture();
    await f.start();
    let resolve!: (value: Response) => void;
    f.send.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const pending = f.access.signIn();
    f.access.stop();
    f.access.start();
    await f.access.inspect();
    resolve(json({ authorizationUrl: authorization() }));
    await pending;
    expect(f.access.getSnapshot().phase).toBe('signed_out');
    expect(f.navigate).not.toHaveBeenCalled();
  });
  it('honors bounded rate-limit metadata without automatically retrying the command', async () => {
    vi.useFakeTimers();
    const f = fixture(undefined, codePending());
    await f.start();
    f.send.mockResolvedValueOnce(error(429, 'RATE_LIMITED', 60));
    await f.access.resend();
    const count = f.send.mock.calls.length;
    expect(count).toBe(3);
    await f.access.resend();
    await f.access.inspect();
    expect(f.send).toHaveBeenCalledTimes(count);
    expect(f.access.getSnapshot().retryAt).toBeGreaterThan(Date.now());
    await vi.advanceTimersByTimeAsync(60001);
    await f.access.inspect();
    await f.access.resend();
    expect(f.send.mock.calls.length).toBeGreaterThan(count);
  });
});
