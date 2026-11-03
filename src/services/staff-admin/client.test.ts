import { afterEach, expect, it, vi } from 'vitest';
import { createStaffAccess, type StaffAccess } from '@/services/staff-access/index';
import { createStaffAdminClient, StaffAdminError } from './client';
import {
  session,
  envelope,
  errorBody,
  ids,
  challenge,
  review,
  restriction,
  member,
} from './fixture.test-helper';
const authorities: StaffAccess[] = [];
const response = (data: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
async function setup(send: typeof fetch, owner = true) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation((url, input) => {
    const path = new URL(url instanceof Request ? url.url : url.toString()).pathname;
    return path === '/admin/v1/session'
      ? Promise.resolve(response(envelope(session(owner))))
      : path === '/admin/v1/auth/email-code'
        ? Promise.resolve(response(errorBody(), 401))
        : send(url, input);
  });
  const access = createStaffAccess({
    origin: 'https://staff.example.test',
    frontendOrigin: 'https://staff.example.test',
    authorizationEndpoint: 'https://identity.example.test/authorize',
    fetcher,
  });
  authorities.push(access);
  access.start();
  await access.inspect();
  return { access, client: createStaffAdminClient(access, 'https://staff.example.test'), fetcher };
}
afterEach(() => {
  for (const access of authorities.splice(0)) access.stop();
  vi.useRealTimers();
});
it('reads stored funding without inventing zero and rejects extra private fields', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response(envelope({ challenge: challenge(), fundingBasis: 'stored_projection' })),
    )
    .mockResolvedValueOnce(
      response(
        envelope({
          challenge: { ...challenge(), sessionSecret: 'forbidden' },
          fundingBasis: 'stored_projection',
        }),
      ),
    );
  const { client } = await setup(send);
  expect((await client.challenge(ids.challenge, new AbortController().signal)).funding).toBeNull();
  await expect(
    client.challenge(ids.challenge, new AbortController().signal),
  ).rejects.toBeInstanceOf(StaffAdminError);
});
it('rejects foreign resource bindings and filtered review rows', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response(
        envelope({
          challenge: { ...challenge(), id: ids.other },
          fundingBasis: 'stored_projection',
        }),
      ),
    )
    .mockResolvedValueOnce(response(envelope({ items: [review()], nextCursor: null })));
  const { client } = await setup(send);
  await expect(client.challenge(ids.challenge, new AbortController().signal)).rejects.toThrow();
  await expect(client.reviews(ids.other, '', null, new AbortController().signal)).rejects.toThrow();
});
it('encodes opaque actor-bound cursors without parsing and rejects duplicate pages', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response(envelope({ items: [], nextCursor: null, fundingBasis: 'stored_projection' })),
    )
    .mockResolvedValueOnce(response(envelope({ items: [member(), member()], nextCursor: null })));
  const { client } = await setup(send);
  await client.challenges(ids.creator, '{"opaque":"a+b"}', new AbortController().signal);
  const input = send.mock.calls[0]![0];
  const url = new URL(input instanceof Request ? input.url : input.toString());
  expect(url.searchParams.get('cursor')).toBe('{"opaque":"a+b"}');
  expect(url.searchParams.get('ownerId')).toBe(ids.creator);
  await expect(client.members(null, new AbortController().signal)).rejects.toThrow();
});
it('Support cannot prepare moderation/member commands or preload directory, audit or restriction', async () => {
  const send = vi.fn<typeof fetch>();
  const { client } = await setup(send, false);
  expect(() => client.prepareRestriction(restriction(), 'Reviewed')).toThrow();
  expect(() => client.prepareMember(member(), 'OWNER_ADMIN', 'Reviewed')).toThrow();
  expect(() => client.prepareTransition(review(), 'Reviewed')).toThrow();
  expect(() =>
    client.prepareInvite('email', 'synthetic@example.test', 'SUPPORT', 'Reviewed'),
  ).toThrow();
  await expect(client.members(null, new AbortController().signal)).rejects.toThrow();
  await expect(client.audit(null, new AbortController().signal)).rejects.toThrow();
  await expect(client.restriction(ids.creator, new AbortController().signal)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
it('binds ban confirmation to exact target/action/revision with immutable nested confirmation', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(response(envelope({ ...restriction(), banned: true, revision: 1 })));
  const { client } = await setup(send);
  const attempt = client.prepareRestriction(restriction(), ' Reviewed concern ');
  expect(attempt.body).toEqual({
    action: 'ban',
    reason: 'Reviewed concern',
    expectedVersion: 0,
    confirmation: { targetId: ids.creator, action: 'ban', expectedVersion: 0 },
  });
  expect(Object.isFrozen(attempt.body.confirmation)).toBe(true);
  await client.execute(attempt);
  const input = send.mock.calls[0]![1];
  expect(new Headers(input?.headers).get('X-Staff-CSRF')).toBe('s'.repeat(43));
  expect(new Headers(input?.headers).get('Idempotency-Key')).toBe(attempt.key);
});
it('unknown restriction result explicitly reuses original key/body and cannot be forged', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('network'))
    .mockResolvedValue(response(envelope({ ...restriction(), banned: true, revision: 1 })));
  const { client } = await setup(send);
  const attempt = client.prepareRestriction(restriction(), 'One reviewed ban');
  await expect(client.execute(attempt)).rejects.toThrow();
  await client.execute(attempt);
  expect(send.mock.calls[0]![1]).toMatchObject({ body: send.mock.calls[1]![1]?.body });
  expect(new Headers(send.mock.calls[0]![1]?.headers).get('Idempotency-Key')).toBe(
    new Headers(send.mock.calls[1]![1]?.headers).get('Idempotency-Key'),
  );
  await expect(client.execute({ ...attempt })).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(2);
});
it('review transitions permit only the next legal state and preserve original/current reason', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      response(envelope({ ...review(), state: 'in_review', revision: 2, reason: 'Investigating' })),
    );
  const { client } = await setup(send);
  const attempt = client.prepareTransition(review(), 'Investigating');
  expect(attempt.body).toMatchObject({
    state: 'in_review',
    expectedVersion: 1,
    confirmation: { targetId: ids.review, state: 'in_review', expectedVersion: 1 },
  });
  await client.execute(attempt);
  expect(() => client.prepareTransition({ ...review(), state: 'resolved' }, 'Again')).toThrow();
});
it.each([
  'https://foreign.example.test/staff/enrol#invitation=' + 'a'.repeat(43),
  'https://staff.example.test/staff/enrol?secret=bad#invitation=' + 'a'.repeat(43),
  'https://staff.example.test/other#invitation=' + 'a'.repeat(43),
])('rejects unbound private invitation destinations', async (url) => {
  const { client } = await setup(
    vi.fn<typeof fetch>().mockResolvedValue(
      response(
        envelope({
          id: ids.invitation,
          role: 'SUPPORT',
          state: 'pending',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          acceptanceUrl: url,
        }),
      ),
    ),
  );
  await expect(
    client.execute(
      client.prepareInvite('email', 'synthetic@example.test', 'SUPPORT', 'Reviewed invite'),
    ),
  ).rejects.toThrow();
});
it('invitation replay can confirm without returning or caching a replacement secret', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(
    response(
      envelope({
        id: ids.invitation,
        role: 'SUPPORT',
        state: 'pending',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        acceptanceUrl: null,
      }),
    ),
  );
  const { client, access } = await setup(send);
  const result = await client.execute(
    client.prepareInvite('subject', 'immutable-test-subject', 'SUPPORT', 'Reviewed'),
  );
  expect(result?.acceptanceUrl).toBeNull();
  expect(access.getSnapshot().scope.queryClient.getQueryCache().getAll()).toHaveLength(0);
});
it('member changes require an active loaded revision and validate returned role/version', async () => {
  const { client } = await setup(
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(envelope({ ...member(), role: 'OWNER_ADMIN', revision: 2 }))),
  );
  expect(() => client.prepareMember(member(), 'SUPPORT', 'Same')).toThrow();
  expect(() =>
    client.prepareMember({ ...member(), active: false }, 'OWNER_ADMIN', 'Inactive'),
  ).toThrow();
  const attempt = client.prepareMember(member(), 'OWNER_ADMIN', 'Reviewed promotion');
  expect(attempt.body).toEqual({
    action: 'change_role',
    role: 'OWNER_ADMIN',
    expectedVersion: 1,
    reason: 'Reviewed promotion',
  });
  await client.execute(attempt);
});
it('401 disposes private queries and old command authority', async () => {
  const { client, access } = await setup(
    vi.fn<typeof fetch>().mockResolvedValue(response(errorBody(), 401)),
  );
  client.scope.queryClient.setQueryData(client.scope.key(['private']), { secret: 'synthetic' });
  await expect(client.challenge(ids.challenge, new AbortController().signal)).rejects.toThrow();
  expect(access.getSnapshot().phase).toBe('expired');
  expect(client.scope.signal.aborted).toBe(true);
  expect(client.scope.queryClient.getQueryCache().getAll()).toHaveLength(0);
});
it('fresh-assurance rejection rechecks staff authority without replaying the command', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(response(errorBody('REAUTHENTICATION_REQUIRED'), 403));
  const { client, access } = await setup(send);
  await expect(
    client.execute(client.prepareRestriction(restriction(), 'Reviewed')),
  ).rejects.toThrow();
  expect(access.getSnapshot().error?.code).toBe('REAUTHENTICATION_REQUIRED');
  expect(client.scope.signal.aborted).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
});
it('honors server cooldown before new reads or writes', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(response(errorBody('RATE_LIMITED'), 429, { 'Retry-After': '2' }));
  const { client } = await setup(send);
  await expect(client.challenge(ids.challenge, new AbortController().signal)).rejects.toThrow();
  expect(client.retryDelay()).toBeGreaterThan(1000);
  await expect(client.challenge(ids.challenge, new AbortController().signal)).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
});
it('rejects wrong-owner challenge pages and an inactive role-change acknowledgement', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response(
        envelope({ items: [challenge()], nextCursor: null, fundingBasis: 'stored_projection' }),
      ),
    )
    .mockResolvedValueOnce(
      response(envelope({ ...member(), role: 'OWNER_ADMIN', active: false, revision: 2 })),
    );
  const { client } = await setup(send);
  await expect(client.challenges(ids.other, null, new AbortController().signal)).rejects.toThrow();
  await expect(
    client.execute(client.prepareMember(member(), 'OWNER_ADMIN', 'Reviewed')),
  ).rejects.toThrow();
});
it('serializes staff mutations and fences a late response after authority disposal', async () => {
  let complete: ((value: Response) => void) | undefined;
  const send = vi.fn<typeof fetch>().mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const { client, access } = await setup(send);
  const attempt = client.prepareRestriction(restriction(), 'One reviewed action');
  const pending = client.execute(attempt);
  const rejection = expect(pending).rejects.toThrow();
  await expect(client.execute(attempt)).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
  access.stop();
  complete?.(response(envelope({ ...restriction(), banned: true, revision: 1 })));
  await rejection;
});
