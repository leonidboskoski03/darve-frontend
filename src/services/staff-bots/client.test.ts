import { afterEach, expect, it, vi } from 'vitest';
import { createStaffAccess, type StaffAccess } from '@/services/staff-access/index';
import { session, envelope, problem, ids } from './fixture.test-helper';
import { createStaffBotClient, StaffBotError } from './client';
const accessList: StaffAccess[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const account = {
  provider: 'TWITCH' as const,
  authorizationId: ids.owner,
  revision: 1,
  connected: true,
  actorKind: 'DEVELOPMENT_TEST' as const,
  channelName: 'Synthetic actor',
  expiresAt: '2030-01-01T00:00:00.000Z',
  scopes: ['user:write:chat'],
  pinPermission: false,
  lastOutcome: null,
  checkedAt: null,
  commandState: null,
};
async function setup(owner = true) {
  const snapshot = session(owner);
  snapshot.permissions = owner ? ['bots.read', 'bots.write'] : [];
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(envelope(snapshot)))
    .mockResolvedValueOnce(json(problem('UNAUTHENTICATED'), 401));
  const access = createStaffAccess({
    origin: 'https://staff.example.test',
    frontendOrigin: 'https://staff.example.test',
    authorizationEndpoint: 'https://identity.example.test/authorize',
    fetcher: send,
  });
  accessList.push(access);
  access.start();
  await access.inspect();
  return { access, send, client: createStaffBotClient(access) };
}
afterEach(() => accessList.splice(0).forEach((access) => access.stop()));
it('owner bot reads do not depend on coin permissions and reject duplicate provider projections', async () => {
  const { client, send } = await setup();
  send.mockResolvedValueOnce(
    json(
      envelope({
        items: [account, { ...account, provider: 'YOUTUBE' }, { ...account, provider: 'KICK' }],
      }),
    ),
  );
  expect(await client.read(new AbortController().signal)).toHaveLength(3);
  send.mockResolvedValueOnce(json(envelope({ items: [account, account, account] })));
  await expect(client.read(new AbortController().signal)).rejects.toBeInstanceOf(StaffBotError);
});
it('Support cannot read, prepare or send a bot command', async () => {
  const { client, send } = await setup(false);
  const before = send.mock.calls.length;
  await expect(client.read(new AbortController().signal)).rejects.toBeInstanceOf(StaffBotError);
  expect(() => client.prepare(account, 'revoke', 'Invented reason')).toThrow();
  expect(send).toHaveBeenCalledTimes(before);
});
it('holds an immutable reviewed command across uncertain results and navigation, then replays the exact key and body', async () => {
  const { client, send, access } = await setup();
  client.prepare(account, 'refresh', 'Synthetic validation');
  expect(Object.isFrozen(client.getSnapshot().attempt?.body.confirmation)).toBe(true);
  send.mockRejectedValueOnce(new TypeError('Synthetic lost response'));
  await client.execute(true);
  expect(client.getSnapshot().phase).toBe('uncertain');
  expect(createStaffBotClient(access)).toBe(client);
  const first = send.mock.calls.at(-1)!;
  expect(() => client.prepare(account, 'revoke', 'Another request')).toThrow();
  send.mockResolvedValueOnce(
    json(
      envelope({
        authorizationId: ids.owner,
        commandId: ids.creator,
        action: 'refresh',
        state: 'queued',
        revision: 1,
      }),
    ),
  );
  await client.execute(true);
  const second = send.mock.calls.at(-1)!;
  expect(second[1]!.body).toBe(first[1]!.body);
  expect(new Headers(second[1]!.headers).get('Idempotency-Key')).toBe(
    new Headers(first[1]!.headers).get('Idempotency-Key'),
  );
  expect(client.getSnapshot()).toMatchObject({ phase: 'recorded', attempt: null });
});
it('a mismatched receipt stays uncertain and authority disposal clears private review state', async () => {
  const { client, send, access } = await setup();
  client.prepare(account, 'revoke', 'Synthetic revoke');
  send.mockResolvedValueOnce(
    json(
      envelope({
        authorizationId: ids.creator,
        commandId: ids.creator,
        action: 'revoke',
        state: 'revoked',
        revision: 2,
      }),
    ),
  );
  await client.execute(true);
  expect(client.getSnapshot().phase).toBe('uncertain');
  access.stop();
  expect(client.getSnapshot().attempt).toBeNull();
  await expect(client.execute(true)).rejects.toBeInstanceOf(StaffBotError);
});
