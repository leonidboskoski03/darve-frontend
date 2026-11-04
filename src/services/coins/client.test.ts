import { afterEach, expect, it, vi } from 'vitest';
import { createCreatorSession, type CreatorSession } from '@/services/creator-session/index';
import { CoinMissionSchema } from '@/services/contracts/index';
import { createCoinReadClient, CoinReadError } from './client';

const stamp = '2026-11-04T12:00:00.000Z';
const identity = {
  authenticated: true,
  user: {
    id: '11223344-1234-4234-8234-112233445566',
    displayName: 'Synthetic coin creator',
    termsStatus: {
      status: 'accepted',
      documentId: 'synthetic',
      requiredVersion: 'v1',
      classification: 'development',
      contentHash: 'a'.repeat(64),
      acceptedVersion: 'v1',
      acceptedAt: stamp,
    },
  },
  expiresAt: '2030-01-01T00:00:00.000Z',
  csrfToken: 'a'.repeat(43),
};
const envelope = (data: unknown) => ({ schemaVersion: 1, serverTime: stamp, data });
const account = (state = 'synchronized', balance = '9007199254740993') => ({
  balance,
  spendableBalance: state === 'synchronized' ? balance : null,
  revision: 1,
  state,
  redemptionAllowed: state === 'synchronized',
});
const missions = () => ({
  progress: 0,
  progressCap: 1000,
  missions: CoinMissionSchema.options.map((id) => ({
    id,
    completed: false,
    earned: null,
    completedAt: null,
    currentReward: null,
  })),
});
const template = {
  id: 'standalone',
  displayName: 'Standalone',
  assetVersion: 1,
  priceRevision: 1,
  amount: '0',
  available: true,
  owned: true,
  ownershipState: 'owned',
};
const selection = {
  revision: 1,
  templateId: 'standalone',
  assetVersion: 1,
  available: true,
  renderer: { key: 'standalone', hash: null },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sessions: CreatorSession[] = [];
function requestUrl(value: string | URL | Request | undefined) {
  if (value === undefined) throw new Error('Expected request');
  return typeof value === 'string' ? value : value instanceof URL ? value.href : value.url;
}
async function setup() {
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(json(identity));
  const session = createCreatorSession({ origin: 'https://api.example.test', fetcher: send });
  sessions.push(session);
  session.start();
  await session.inspect();
  return {
    send,
    session,
    client: createCoinReadClient(session),
    signal: new AbortController().signal,
  };
}
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions.length = 0;
});

it.each(['unconfigured', 'unavailable', 'synchronization_pending', 'synchronized'])(
  'preserves exact balance, null spending and %s authority',
  async (state) => {
    const { send, client, signal } = await setup();
    send.mockResolvedValueOnce(json(envelope(account(state))));
    const result = await client.account(signal);
    expect(result.data).toEqual(account(state));
    expect(send.mock.calls[1]?.[1]?.credentials).toBe('include');
    expect(send.mock.calls[1]?.[1]?.method).toBe('GET');
    expect(send.mock.calls[1]?.[1]?.body).toBeUndefined();
  },
);
it('reads all six intended resources through their exact timed envelopes', async () => {
  const { send, client, signal } = await setup();
  const values = [
    envelope(missions()),
    envelope({ templates: [template] }),
    envelope({ templates: [template] }),
    envelope(selection),
    envelope({ items: [], nextCursor: null }),
  ];
  for (const value of values) send.mockResolvedValueOnce(json(value));
  await client.missions(signal);
  await client.catalogue(signal);
  await client.entitlements(signal);
  await client.selection(signal);
  await client.ledger({}, signal);
  expect(send.mock.calls.slice(1).map((call) => new URL(requestUrl(call[0])).pathname)).toEqual([
    '/api/coins/missions',
    '/api/templates',
    '/api/template-entitlements',
    '/api/template-preferences',
    '/api/coins/ledger',
  ]);
});
it.each([
  { balance: 0 },
  { spendableBalance: '01' },
  { balance: '9223372036854775808' },
  { ownerId: 'private-field' },
  { revision: -1 },
])('rejects malformed or private account fields: %j', async (change) => {
  const { send, client, signal } = await setup();
  send.mockResolvedValueOnce(json(envelope({ ...account(), ...change })));
  await expect(client.account(signal)).rejects.toBeInstanceOf(CoinReadError);
});
it('rejects duplicate mission IDs and catalogue IDs', async () => {
  const { send, client, signal } = await setup();
  const value = missions();
  value.missions[1] = value.missions[0]!;
  send
    .mockResolvedValueOnce(json(envelope(value)))
    .mockResolvedValueOnce(json(envelope({ templates: [template, template] })));
  await expect(client.missions(signal)).rejects.toBeInstanceOf(CoinReadError);
  await expect(client.catalogue(signal)).rejects.toBeInstanceOf(CoinReadError);
});
it('keeps cursor bytes opaque, encodes them once and rejects caller pagination overrides', async () => {
  const { send, client, signal } = await setup();
  const cursor = 'opaque+/=&?';
  send.mockResolvedValueOnce(json(envelope({ items: [], nextCursor: 'next-opaque' })));
  expect((await client.ledger({ cursor }, signal)).data.nextCursor).toBe('next-opaque');
  expect(requestUrl(send.mock.calls[1]?.[0])).toBe(
    'https://api.example.test/api/coins/ledger?cursor=' + encodeURIComponent(cursor),
  );
  for (const query of [
    { limit: 100 },
    { ownerId: identity.user.id },
    { cursor: ['x'] },
    { cursor: 'x'.repeat(4097) },
  ])
    expect(() => client.ledger(query, signal)).toThrow(CoinReadError);
  expect(send).toHaveBeenCalledTimes(2);
});
it('rejects a repeated ledger cursor and contradictory mission completion', async () => {
  const { send, client, signal } = await setup();
  send.mockResolvedValueOnce(json(envelope({ items: [], nextCursor: 'same-cursor' })));
  await expect(client.ledger({ cursor: 'same-cursor' }, signal)).rejects.toBeInstanceOf(
    CoinReadError,
  );
  const value = missions();
  send.mockResolvedValueOnce(
    json(
      envelope({
        ...value,
        missions: value.missions.map((row, index) =>
          index === 0 ? { ...row, completed: true } : row,
        ),
      }),
    ),
  );
  await expect(client.missions(signal)).rejects.toBeInstanceOf(CoinReadError);
});
it('rejects unordered or duplicate ledger rows', async () => {
  const { send, client, signal } = await setup();
  const row = {
    id: '22334455-1234-4234-8234-112233445566',
    revision: 1,
    delta: '1',
    balance: '1',
    kind: 'mission',
    createdAt: stamp,
  };
  for (const items of [
    [row, row],
    [row, { ...row, id: '33445566-1234-4234-8234-112233445566', revision: 2 }],
  ]) {
    send.mockResolvedValueOnce(json(envelope({ items, nextCursor: null })));
    await expect(client.ledger({}, signal)).rejects.toBeInstanceOf(CoinReadError);
  }
});
it.each([201, 202, 204])(
  'rejects unexpected success status %i instead of confirming coin state',
  async (status) => {
    const { send, client, signal } = await setup();
    send.mockResolvedValueOnce(
      status === 204 ? new Response(null, { status }) : json(envelope(account()), status),
    );
    await expect(client.account(signal)).rejects.toBeInstanceOf(CoinReadError);
  },
);
it('rejects direct-root or unversioned data and never invents a zero wallet', async () => {
  const { send, client, signal } = await setup();
  for (const body of [
    account(),
    { schemaVersion: 1, data: account() },
    { schemaVersion: 2, serverTime: stamp, data: account() },
  ]) {
    send.mockResolvedValueOnce(json(body));
    await expect(client.account(signal)).rejects.toBeInstanceOf(CoinReadError);
  }
});
it('returns a safe unavailable failure with no automatic retry', async () => {
  const { send, client, signal } = await setup();
  send.mockResolvedValueOnce(
    json(
      {
        schemaVersion: 1,
        serverTime: stamp,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'private failure text',
          requestId: 'synthetic-coin-request',
          retryable: true,
          retryAfterSeconds: null,
          issues: [],
          refetch: null,
        },
      },
      503,
    ),
  );
  const error = await client.account(signal).catch((e) => e as unknown);
  expect(error).toBeInstanceOf(CoinReadError);
  expect(error).toMatchObject({ failure: { status: 503, code: 'SERVICE_UNAVAILABLE' } });
  expect(String(error)).not.toContain('private failure');
  expect(send).toHaveBeenCalledTimes(2);
});
it('fences late results and rejects reuse after creator authority ends', async () => {
  const { send, client, session, signal } = await setup();
  let settle!: (value: Response) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const pending = client.account(signal);
  session.stop();
  settle(json(envelope(account())));
  await expect(pending).rejects.toBeInstanceOf(CoinReadError);
  await expect(client.account(signal)).rejects.toBeInstanceOf(CoinReadError);
  expect(send).toHaveBeenCalledTimes(2);
});
it('refuses private reads before authentication', async () => {
  const send = vi.fn<typeof fetch>();
  const session = createCreatorSession({ origin: 'https://api.example.test', fetcher: send });
  sessions.push(session);
  await expect(
    createCoinReadClient(session).account(new AbortController().signal),
  ).rejects.toBeInstanceOf(CoinReadError);
  expect(send).not.toHaveBeenCalled();
});
