import { afterEach, expect, it, vi } from 'vitest';
import { createStaffAccess, type StaffAccess } from '@/services/staff-access/index';
import { createStaffSupportClient } from './client';
import {
  ids,
  staffSession,
  queue,
  ticket,
  envelope,
  errorBody,
  message,
} from './fixture.test-helper';
const active: StaffAccess[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function setup(owner = false) {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(envelope(staffSession(owner))))
    .mockResolvedValueOnce(json(errorBody(), 401));
  const access = createStaffAccess({
    origin: 'https://staff.example.test',
    frontendOrigin: 'https://staff.example.test',
    authorizationEndpoint: 'https://identity.example.test/authorize',
    fetcher: send,
  });
  active.push(access);
  access.start();
  await access.inspect();
  return { send, access, client: createStaffSupportClient(access) };
}
afterEach(() => {
  active.splice(0).forEach((access) => access.stop());
  window.sessionStorage.clear();
});
it('claims only the observed queue revision with exact staff proof/key and explicit uncertain retry', async () => {
  const { send, client } = await setup();
  const attempt = client.prepareClaim(queue(), ' Claim reviewed work ');
  expect(attempt.body).toEqual({ expectedAuthorityRevision: 5, reason: 'Claim reviewed work' });
  send
    .mockRejectedValueOnce(new TypeError('private-network'))
    .mockResolvedValueOnce(json(envelope({ ticketId: ids.ticket })));
  await expect(client.execute(attempt)).rejects.toMatchObject({ problem: { category: 'network' } });
  expect(send).toHaveBeenCalledTimes(3);
  await client.execute(attempt);
  const calls = send.mock.calls.slice(2);
  expect(calls[0]?.[1]?.body).toBe(calls[1]?.[1]?.body);
  for (const [url, options] of calls) {
    expect(url).toBe(
      'https://staff.example.test/admin/v1/support/tickets/' + ids.ticket + '/claims',
    );
    expect(new Headers(options?.headers).get('x-staff-csrf')).toBe('s'.repeat(43));
    expect(new Headers(options?.headers).get('X-CSRF-Token')).toBeNull();
    expect(new Headers(options?.headers).get('Idempotency-Key')).toBe(attempt.key);
  }
});
it('denies Support reassignment before sending and preserves server authorization as final authority', async () => {
  const { client, send } = await setup();
  expect(() =>
    client.prepareTicket('reassign', ticket(), { assigneeId: ids.other, reason: 'not permitted' }),
  ).toThrow();
  expect(send).toHaveBeenCalledTimes(2);
});
it('binds availability, reply, note, read and status to separate current revisions', async () => {
  const { client } = await setup();
  const current = ticket();
  expect(client.prepareAvailability({ available: false, revision: 3 }, true).body).toEqual({
    available: true,
    expectedRevision: 3,
  });
  expect(client.prepareTicket('reply', current, { body: 'Hi' }).body).toEqual({
    body: 'Hi',
    expectedRevision: 2,
    expectedAuthorityRevision: 5,
  });
  expect(client.prepareTicket('note', current, { body: 'Internal' }).body).toEqual({
    body: 'Internal',
    expectedAuthorityRevision: 5,
  });
  expect(client.prepareTicket('read', current, { sequence: 4, notes: true }).body).toEqual({
    sequence: 4,
    notes: true,
  });
  expect(
    client.prepareTicket('status', current, {
      status: 'resolved',
      reason: 'Done',
      reply: 'Final public reply',
    }).body,
  ).toMatchObject({
    status: 'resolved',
    expectedRevision: 2,
    expectedAuthorityRevision: 5,
    reply: 'Final public reply',
  });
});
it('requires complete reassign target and refuses silent staff reopening', async () => {
  const { client } = await setup(true);
  expect(() => client.prepareTicket('reassign', ticket(), { reason: 'missing target' })).toThrow();
  expect(() =>
    client.prepareTicket(
      'status',
      { ...ticket(), status: 'resolved' },
      { status: 'in_progress', reason: 'no silent reopen' },
    ),
  ).toThrow();
});
it('rejects forged, cross-scope and concurrent commands without a second network write', async () => {
  const { client, send, access } = await setup();
  const held = client.prepareClaim(queue(), 'reviewed');
  await expect(client.execute({ ...held })).rejects.toThrow();
  let release!: (value: Response) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  const first = client.execute(held);
  await expect(client.execute(held)).rejects.toMatchObject({
    problem: { code: 'COMMAND_IN_PROGRESS' },
  });
  access.stop();
  release(json(envelope({ ticketId: ids.ticket })));
  await expect(first).rejects.toMatchObject({ problem: { code: 'AUTHORITY_CHANGED' } });
});
it('clears staff authority/cache on a real 401 transport response', async () => {
  const { client, send, access } = await setup();
  const scope = access.getSnapshot().scope;
  scope.queryClient.setQueryData(scope.key(['private']), 'private');
  send.mockResolvedValueOnce(json(errorBody(), 401));
  await expect(client.availability(new AbortController().signal)).rejects.toThrow();
  expect(scope.signal.aborted).toBe(true);
  expect(scope.queryClient.getQueryCache().getAll()).toHaveLength(0);
  expect(access.getSnapshot().phase).toBe('expired');
});
it.each(['foreign', 'note-author', 'duplicate', 'changed-authority'] as const)(
  'rejects %s history without mixing private snapshots',
  async (kind) => {
    const { send, client } = await setup();
    const before = ticket();
    const after = {
      ...before,
      ...(kind === 'foreign'
        ? { assigneeId: ids.other }
        : kind === 'changed-authority'
          ? { authorityRevision: 6 }
          : {}),
    };
    const items =
      kind === 'duplicate'
        ? [message(), message()]
        : kind === 'note-author'
          ? [{ ...message(), author: 'streamer' }]
          : [message()];
    send
      .mockResolvedValueOnce(json(envelope(before)))
      .mockResolvedValueOnce(json(envelope({ items, nextCursor: null })))
      .mockResolvedValueOnce(json(envelope(after)));
    await expect(
      client.thread(ids.ticket, 'notes', null, new AbortController().signal),
    ).rejects.toThrow();
  },
);
it('keeps null redaction authoritative in a separately keyed note page', async () => {
  const { send, client } = await setup();
  send
    .mockResolvedValueOnce(json(envelope(ticket())))
    .mockResolvedValueOnce(
      json(envelope({ items: [{ ...message(), body: null, redacted: true }], nextCursor: null })),
    )
    .mockResolvedValueOnce(json(envelope(ticket())));
  const result = await client.thread(ids.ticket, 'notes', null, new AbortController().signal);
  expect(result.kind).toBe('notes');
  expect(result.page.items[0]?.body).toBeNull();
});
it('rejects queue payloads that try to preload an owner or message', async () => {
  const { send, client } = await setup();
  send.mockResolvedValueOnce(
    json(envelope({ items: [{ ...queue(), ownerId: ids.owner }], nextCursor: null })),
  );
  await expect(client.page('queue', null, new AbortController().signal)).rejects.toMatchObject({
    problem: { category: 'protocol' },
  });
});
