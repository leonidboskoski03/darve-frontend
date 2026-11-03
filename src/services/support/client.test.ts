import { afterEach, expect, it, vi } from 'vitest';
import { createCreatorSession, type CreatorSession } from '@/services/creator-session/index';
import { syntheticSupportSession } from './fixture.test-helper';
import { createSupportClient, SupportError, uncertainSupport } from './client';
import { ids, ticket, message, envelope, errorBody } from './fixture.test-helper';
const active: CreatorSession[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
async function setup() {
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(json(syntheticSupportSession));
  const session = createCreatorSession({ origin: 'https://api.example.test', fetcher: send });
  active.push(session);
  session.start();
  await session.inspect();
  return { send, session, client: createSupportClient(session) };
}
afterEach(() => {
  active.forEach((session) => session.stop());
  active.length = 0;
  vi.useRealTimers();
});
it('keeps creator-only writes exact and stable across an uncertain deliberate retry', async () => {
  const { send, client } = await setup();
  const draft = {
    category: 'account',
    body: ' A question ',
    contexts: [{ kind: 'challenge', id: ids.context }],
  };
  const held = client.prepareCreate(draft);
  draft.body = 'changed';
  draft.contexts[0]!.id = ids.other;
  send
    .mockRejectedValueOnce(new TypeError('private-network-info'))
    .mockResolvedValueOnce(json(envelope({ ticketId: ids.ticket, messageId: message().id })));
  let error: unknown;
  try {
    await client.execute(held);
  } catch (problem) {
    error = problem;
  }
  expect(uncertainSupport(error)).toBe(true);
  expect(send).toHaveBeenCalledTimes(2);
  await client.execute(held);
  const requests = send.mock.calls.slice(1);
  expect(requests[0]?.[1]?.body).toBe(requests[1]?.[1]?.body);
  expect(JSON.parse(typeof requests[0]?.[1]?.body === 'string' ? requests[0][1].body : '')).toEqual(
    {
      category: 'account',
      body: 'A question',
      contexts: [{ kind: 'challenge', id: ids.context }],
    },
  );
  for (const [url, options] of requests) {
    expect(url).toBe('https://api.example.test/api/support/tickets');
    expect(new Headers(options?.headers).get('Idempotency-Key')).toBe(held.key);
    expect(new Headers(options?.headers).get('X-CSRF-Token')).toBe(
      syntheticSupportSession.csrfToken,
    );
    expect(new Headers(options?.headers).has('X-Staff-CSRF')).toBe(false);
    expect(options?.referrerPolicy).toBe('no-referrer');
  }
  expect(Object.isFrozen(held.body.contexts)).toBe(true);
});
it.each(['', 'x'.repeat(8001)])('rejects invalid message bodies before network', async (body) => {
  const { send, client } = await setup();
  expect(() => client.prepareCreate({ category: 'account', body })).toThrow(SupportError);
  expect(send).toHaveBeenCalledTimes(1);
});
it('rejects forged and previous-lifetime attempts', async () => {
  const { client, session, send } = await setup();
  const held = client.prepareReply(ticket(), 'hello');
  await expect(client.execute({ ...held })).rejects.toThrow(SupportError);
  send.mockResolvedValueOnce(json(syntheticSupportSession));
  await session.inspect();
  await expect(client.execute(held)).rejects.toMatchObject({
    problem: { code: 'AUTHORITY_CHANGED' },
  });
});
it('fences late results after authority disposal', async () => {
  const { client, session, send } = await setup();
  let release!: (value: Response) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  const pending = client.execute(client.prepareReply(ticket(), 'late'));
  session.stop();
  release(json(envelope({ ticketId: ids.ticket, messageId: message().id })));
  await expect(pending).rejects.toMatchObject({ problem: { code: 'AUTHORITY_CHANGED' } });
});
it('rejects wrong-resource and staff-only mutation results', async () => {
  const { send, client } = await setup();
  send
    .mockResolvedValueOnce(json(envelope({ ticketId: ids.other, messageId: message().id })))
    .mockResolvedValueOnce(json(envelope({ available: true, revision: 1 })));
  const held = client.prepareReply(ticket(), 'hello');
  await expect(client.execute(held)).rejects.toMatchObject({ problem: { category: 'protocol' } });
  await expect(client.execute(held)).rejects.toMatchObject({ problem: { category: 'protocol' } });
});
it('uses separate public/context/read revisions without staff note marks', async () => {
  const { send, client } = await setup();
  const current = { ...ticket(), revision: 7, contextRevision: 3 };
  const reply = client.prepareReply(current, 'reopen');
  const context = client.prepareContext(
    current,
    { kind: 'round', id: ids.context },
    'revoke',
    ' no longer relevant ',
  );
  const read = client.prepareRead(current, 2);
  expect(reply.body).toEqual({ body: 'reopen', expectedRevision: 7 });
  expect(context.body).toEqual({
    context: { kind: 'round', id: ids.context },
    operation: 'revoke',
    reason: 'no longer relevant',
    expectedContextRevision: 3,
  });
  expect(read.body).toEqual({ sequence: 2, notes: false });
  send.mockResolvedValueOnce(json(envelope({ ticketId: ids.ticket, sequence: 1 })));
  await expect(client.execute(read)).rejects.toMatchObject({ problem: { category: 'protocol' } });
});
it('requires a coherent thread across history and canonical reads', async () => {
  const { send, client } = await setup();
  send
    .mockResolvedValueOnce(json(envelope(ticket())))
    .mockResolvedValueOnce(json(envelope({ items: [message()], nextCursor: null })))
    .mockResolvedValueOnce(json(envelope({ ...ticket(), revision: 2 })));
  await expect(client.thread(ids.ticket, null, new AbortController().signal)).rejects.toMatchObject(
    { problem: { status: 409 } },
  );
});
it.each(['duplicate', 'redacted', 'staff-field'] as const)(
  'rejects invalid %s history',
  async (kind) => {
    const { send, client } = await setup();
    const items =
      kind === 'duplicate'
        ? [message(), message()]
        : kind === 'redacted'
          ? [{ ...message(), redacted: true }]
          : [{ ...message(), actorId: ids.other }];
    send
      .mockResolvedValueOnce(json(envelope(ticket())))
      .mockResolvedValueOnce(json(envelope({ items, nextCursor: null })))
      .mockResolvedValueOnce(json(envelope(ticket())));
    await expect(
      client.thread(ids.ticket, null, new AbortController().signal),
    ).rejects.toMatchObject({ problem: { category: 'protocol' } });
  },
);
it('retains authoritative null redaction without old text', async () => {
  const { send, client } = await setup();
  send
    .mockResolvedValueOnce(json(envelope(ticket())))
    .mockResolvedValueOnce(
      json(envelope({ items: [{ ...message(), body: null, redacted: true }], nextCursor: null })),
    )
    .mockResolvedValueOnce(json(envelope(ticket())));
  expect(
    (await client.thread(ids.ticket, null, new AbortController().signal)).messages.items[0]?.body,
  ).toBeNull();
});
it('passes opaque cursors unchanged and rejects loops', async () => {
  const { send, client } = await setup();
  send.mockResolvedValueOnce(json(envelope({ items: [ticket()], nextCursor: null })));
  await client.tickets('opaque+/=token', new AbortController().signal);
  expect(send.mock.calls[1]?.[0] as string).toContain('cursor=opaque%2B%2F%3Dtoken');
  send.mockResolvedValueOnce(json(envelope({ items: [ticket()], nextCursor: 'same' })));
  await expect(client.tickets('same', new AbortController().signal)).rejects.toThrow(SupportError);
});
it('honors the current retry delay for reads and commands without automatic replay', async () => {
  const { send, client } = await setup();
  const attempt = client.prepareCreate({ category: 'account', body: 'help' });
  send.mockResolvedValueOnce(json(errorBody('RATE_LIMITED', 3), 429));
  await expect(client.execute(attempt)).rejects.toMatchObject({ problem: { status: 429 } });
  await expect(client.tickets(null, new AbortController().signal)).rejects.toMatchObject({
    problem: { status: 429 },
  });
  await expect(client.execute(attempt)).rejects.toMatchObject({ problem: { status: 429 } });
  expect(send).toHaveBeenCalledTimes(2);
});
