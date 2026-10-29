import { afterEach, expect, it, vi } from 'vitest';
import { createCreatorSession, type CreatorSession } from '@/services/creator-session/index';
import { RoundResponseSchema } from '@/services/contracts/index';
import { createCollectionClient, CollectionError } from './client';
import { remainingCollectionSeconds, roundIsFresh, retainNewerRound } from './clock';
import { syntheticSession, roundFixture, ids } from './fixture.test-helper';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const active: CreatorSession[] = [];
async function setup() {
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(json(syntheticSession));
  const session = createCreatorSession({ origin: 'https://api.example.test', fetcher: send });
  active.push(session);
  session.start();
  await session.inspect();
  return { send, session, client: createCollectionClient(session, () => 1000) };
}
afterEach(() => {
  active.forEach((s) => s.stop());
  active.length = 0;
});
const startInput = {
  connectionId: ids.connection,
  broadcastId: ids.broadcast,
  collectionDurationSeconds: 30,
  announcementPinMode: 'off',
} as const;
it.each(['preparing', 'collecting', 'closed', 'failed'] as const)(
  'synthetic %s fixture satisfies the exact pinned wire',
  (state) => {
    expect(RoundResponseSchema.safeParse(roundFixture(state)).success).toBe(true);
  },
);
it('uses explicit 202 and the same frozen request/key on a deliberate retry', async () => {
  const { client, send } = await setup();
  const attempt = client.prepareStart(startInput);
  send
    .mockResolvedValueOnce(json(roundFixture(), 202))
    .mockResolvedValueOnce(json(roundFixture(), 202));
  expect((await client.start(attempt)).round.state).toBe('preparing');
  await client.start(attempt);
  const calls = send.mock.calls.slice(1);
  expect(calls).toHaveLength(2);
  for (const [, options] of calls) {
    expect(options?.body).toBe(JSON.stringify(startInput));
    expect(new Headers(options?.headers).get('Idempotency-Key')).toBe(attempt.key);
    expect(new Headers(options?.headers).get('X-CSRF-Token')).toBe(syntheticSession.csrfToken);
  }
  expect(Object.isFrozen(attempt.input)).toBe(true);
});
it.each([0, 61, 1.5])('rejects invalid duration %s without sending', async (duration) => {
  const { client, send } = await setup();
  expect(() => client.prepareStart({ ...startInput, collectionDurationSeconds: duration })).toThrow(
    CollectionError,
  );
  expect(send).toHaveBeenCalledTimes(1);
});
it('rejects unsupported legacy delay and malformed source IDs', async () => {
  const { client } = await setup();
  expect(() => client.prepareStart({ ...startInput, delay: 10 })).toThrow();
  expect(() => client.prepareStart({ ...startInput, broadcastId: '../../other' })).toThrow();
});
it('does not automatically replay a network-uncertain Start', async () => {
  const { client, send } = await setup();
  send.mockRejectedValueOnce(new TypeError('private-network-detail'));
  await expect(client.start(client.prepareStart(startInput))).rejects.toMatchObject({
    problem: { category: 'network' },
  });
  expect(send).toHaveBeenCalledTimes(2);
});
it('rejects authority changes before a prior client can command the new session', async () => {
  const { client, session, send } = await setup();
  const attempt = client.prepareStart(startInput);
  send.mockResolvedValueOnce(json(syntheticSession));
  await session.inspect();
  await expect(client.start(attempt)).rejects.toMatchObject({
    problem: { code: 'AUTHORITY_CHANGED' },
  });
  expect(send).toHaveBeenCalledTimes(2);
});
it('fences a late command response after session rotation', async () => {
  const { client, session, send } = await setup();
  let release!: (response: Response) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = client.start(client.prepareStart(startInput));
  session.stop();
  release(json(roundFixture(), 202));
  await expect(pending).rejects.toBeInstanceOf(CollectionError);
});
it('rejects an overlapping command and binds Stop to the reviewed version', async () => {
  const { client, send } = await setup();
  let release!: (response: Response) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = client.start(client.prepareStart(startInput));
  await expect(client.stop({ id: ids.round, version: 1 })).rejects.toMatchObject({
    problem: { code: 'COMMAND_IN_PROGRESS' },
  });
  release(json(roundFixture(), 202));
  await pending;
  send.mockResolvedValueOnce(json(roundFixture('failed'), 202));
  expect((await client.stop({ id: ids.round, version: 1 })).round.closeReason).toBe(
    'PREPARATION_CANCELLED',
  );
  expect(send.mock.calls.at(-1)?.[1]?.body).toBe('{"expectedVersion":1}');
});
it('rejects foreign-owner and wrong-resource projections', async () => {
  const { client, send } = await setup();
  const foreign = roundFixture();
  foreign.data.ownerId = ids.connection;
  send.mockResolvedValueOnce(json(foreign));
  await expect(client.round(ids.round, new AbortController().signal)).rejects.toMatchObject({
    problem: { code: 'COLLECTION_RESOURCE_MISMATCH' },
  });
  send.mockResolvedValueOnce(json(roundFixture()));
  await expect(client.round(ids.connection, new AbortController().signal)).rejects.toBeInstanceOf(
    CollectionError,
  );
});
it('rejects a Start response for a different selected stream', async () => {
  const { client, send } = await setup();
  const value = roundFixture();
  value.data.broadcastId = ids.owner;
  send.mockResolvedValueOnce(json(value, 202));
  await expect(client.start(client.prepareStart(startInput))).rejects.toBeInstanceOf(
    CollectionError,
  );
});
it('rejects a fabricated start attempt and invalid Stop path before sending', async () => {
  const { client, send } = await setup();
  await expect(client.start({ ...client.prepareStart(startInput) })).rejects.toBeInstanceOf(
    CollectionError,
  );
  await expect(client.stop({ id: '../../other', version: 1 })).rejects.toBeInstanceOf(
    CollectionError,
  );
  expect(send).toHaveBeenCalledTimes(1);
});
it('uses a monotonic presentation clock, hides stale/slow/backward reads and never creates a command', () => {
  const value = RoundResponseSchema.parse(roundFixture('collecting'));
  const read = {
    round: value.data,
    serverTime: value.serverTime,
    receivedAt: 1000,
    requestedAt: 900,
  };
  expect(remainingCollectionSeconds(read, 2000)).toBe(29);
  expect(remainingCollectionSeconds(read, 6000)).toBeNull();
  expect(roundIsFresh(read, 999)).toBe(false);
  expect(roundIsFresh({ ...read, requestedAt: -5000 }, 1000)).toBe(false);
  expect(
    remainingCollectionSeconds({ ...read, round: { ...read.round, state: 'preparing' } }, 2000),
  ).toBeNull();
});
it('retains a higher round version without freshening its old timing anchor', () => {
  const value = RoundResponseSchema.parse(roundFixture('collecting'));
  const previous = {
    round: value.data,
    serverTime: value.serverTime,
    requestedAt: 900,
    receivedAt: 1000,
  };
  const older = { ...previous, round: { ...value.data, version: 1 }, receivedAt: 2000 };
  expect(retainNewerRound(previous, older)).toBe(previous);
});
