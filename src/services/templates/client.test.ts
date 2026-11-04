import { afterEach, expect, it, vi } from 'vitest';
import { createCreatorSession, type CreatorSession } from '@/services/creator-session/index';
import { syntheticTemplateSession as syntheticReportingSession } from './fixture.test-helper';
import {
  createTemplateClient,
  redemptionBlock,
  TemplateError,
  type TemplateResources,
} from './client';
const stamp = '2026-11-04T12:00:00.000Z';
const envelope = (data: unknown) => ({ schemaVersion: 1, serverTime: stamp, data });
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const item = {
  id: 'synthetic',
  displayName: 'Synthetic template',
  assetVersion: 1,
  priceRevision: 1,
  amount: '25',
  available: true,
  owned: false,
  ownershipState: 'not_owned' as const,
};
const resources = (): TemplateResources => ({
  account: envelope({
    balance: '100',
    spendableBalance: '100',
    revision: 1,
    state: 'synchronized',
    redemptionAllowed: true,
  }) as TemplateResources['account'],
  catalogue: envelope({ templates: [{ ...item }] }) as TemplateResources['catalogue'],
  entitlements: envelope({ templates: [] }) as TemplateResources['entitlements'],
});
const pending = {
  templateId: 'synthetic',
  state: 'synchronization_pending',
  charged: '25',
  transactionId: '11223344-1234-4234-8234-112233445566',
  redemptionId: '22334455-1234-4234-8234-112233445566',
};
const sessions: CreatorSession[] = [];
async function setup() {
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(json(syntheticReportingSession));
  const session = createCreatorSession({ origin: 'https://api.example.test', fetcher: send });
  sessions.push(session);
  session.start();
  await session.inspect();
  return { send, session, client: createTemplateClient(session) };
}
const problem = (code: string, retryAfterSeconds: number | null = null) => ({
  schemaVersion: 1,
  serverTime: stamp,
  error: {
    code,
    message: 'private diagnostic',
    requestId: 'synthetic-template',
    retryable: retryAfterSeconds !== null,
    retryAfterSeconds,
    issues: [],
    refetch: null,
  },
});
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions.length = 0;
  vi.restoreAllMocks();
});
it('reads all authoritative resources without writing or manufacturing ownership', async () => {
  const { send, client } = await setup(),
    data = resources();
  for (const value of [data.account, data.catalogue, data.entitlements])
    send.mockResolvedValueOnce(json(value));
  expect(await client.resources(new AbortController().signal)).toEqual(data);
  expect(send.mock.calls.slice(1).map((call) => call[1]?.method)).toEqual(['GET', 'GET', 'GET']);
});
it('requires explicit review, freezes exact integer input and prevents duplicate submissions', async () => {
  const { send, client } = await setup(),
    data = resources();
  data.account.data.balance = data.account.data.spendableBalance = '9007199254740993';
  data.catalogue.data.templates[0]!.amount = '9007199254740993';
  client.prepare(data, item.id);
  const attempt = client.getSnapshot().attempt!;
  expect(Object.isFrozen(attempt.input.confirmation)).toBe(true);
  await expect(client.redeem(false)).rejects.toBeInstanceOf(TemplateError);
  expect(send).toHaveBeenCalledTimes(1);
  let settle!: (response: Response) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const running = client.redeem(true);
  await expect(client.redeem(true)).rejects.toBeInstanceOf(TemplateError);
  expect(client.getSnapshot().phase).toBe('sending');
  settle(json(envelope({ ...pending, charged: attempt.input.amount })));
  await running;
  expect(client.getSnapshot().phase).toBe('pending');
  expect(JSON.parse(send.mock.calls[1]![1]!.body as string)).toEqual(attempt.input);
  expect(new Headers(send.mock.calls[1]![1]!.headers).get('Idempotency-Key')).toBe(attempt.key);
  expect(new Headers(send.mock.calls[1]![1]!.headers).get('X-CSRF-Token')).toBe(
    syntheticReportingSession.csrfToken,
  );
  await expect(client.redeem(true)).rejects.toBeInstanceOf(TemplateError);
});
it.each([
  'PRICE_CHANGED',
  'STALE_VERSION',
  'INSUFFICIENT_BALANCE',
  'SYNCHRONIZATION_PENDING',
  'CONFLICT',
])('requires a new unchecked review after definite %s rejection', async (code) => {
  const { send, client } = await setup();
  client.prepare(resources(), item.id);
  const key = client.getSnapshot().attempt!.key;
  send.mockResolvedValueOnce(json(problem(code), 409));
  await client.redeem(true);
  expect(client.getSnapshot()).toMatchObject({ phase: 'rejected', attempt: null, error: { code } });
  const changed = resources();
  changed.catalogue.data.templates[0]!.amount = '30';
  changed.catalogue.data.templates[0]!.priceRevision = 2;
  client.prepare(changed, item.id);
  expect(client.getSnapshot().attempt!.input.amount).toBe('30');
  expect(client.getSnapshot().attempt!.key).not.toBe(key);
  await expect(client.redeem(false)).rejects.toBeInstanceOf(TemplateError);
});
it.each(['network', 'malformed', 'wrong-id', 'wrong-charge', 'unexpected-status', 'server'])(
  'holds exactly the same request after %s uncertainty, including navigation recreation',
  async (mode) => {
    const { send, client, session } = await setup();
    client.prepare(resources(), item.id);
    const attempt = client.getSnapshot().attempt;
    if (mode === 'network') send.mockRejectedValueOnce(new TypeError('private network failure'));
    else
      send.mockResolvedValueOnce(
        mode === 'malformed'
          ? json({ wrong: true })
          : mode === 'server'
            ? json(problem('SERVICE_UNAVAILABLE'), 503)
            : json(
                envelope({
                  ...pending,
                  ...(mode === 'wrong-id'
                    ? { templateId: 'other' }
                    : mode === 'wrong-charge'
                      ? { charged: '26' }
                      : {}),
                }),
                mode === 'unexpected-status' ? 201 : 200,
              ),
      );
    await client.redeem(true);
    expect(client.getSnapshot().phase).toBe('uncertain');
    expect(createTemplateClient(session)).toBe(client);
    expect(client.getSnapshot().attempt).toBe(attempt);
    expect(send).toHaveBeenCalledTimes(2);
    client.cancelReview();
    expect(client.getSnapshot().attempt).toBe(attempt);
    expect(() => client.prepare(resources(), item.id)).toThrow(TemplateError);
    send.mockResolvedValueOnce(json(envelope(pending)));
    await client.redeem(true);
    expect(send.mock.calls[2]![1]!.body).toBe(send.mock.calls[1]![1]!.body);
    expect(new Headers(send.mock.calls[2]![1]!.headers).get('Idempotency-Key')).toBe(attempt!.key);
    expect(client.getSnapshot().phase).toBe('pending');
  },
);
it('honours throttling without an automatic retry or a replacement key', async () => {
  const { send, client } = await setup();
  client.prepare(resources(), item.id);
  send.mockResolvedValueOnce(json(problem('RATE_LIMITED', 5), 429));
  await client.redeem(true);
  expect(client.getSnapshot().phase).toBe('uncertain');
  await expect(client.redeem(true)).rejects.toBeInstanceOf(TemplateError);
  expect(send).toHaveBeenCalledTimes(2);
  vi.spyOn(Date, 'now').mockReturnValue(client.getSnapshot().retryAt);
  send.mockResolvedValueOnce(json(envelope(pending)));
  await client.redeem(true);
  expect(client.getSnapshot().phase).toBe('pending');
});
it('never equates a response or unsealed entitlement with verified ownership', async () => {
  const { send, client } = await setup();
  client.prepare(resources(), item.id);
  send.mockResolvedValueOnce(json(envelope(pending)));
  await client.redeem(true);
  client.reconcile(resources());
  expect(client.getSnapshot().phase).toBe('pending');
  const data = resources();
  data.entitlements.data.templates = [
    { ...item, owned: true, ownershipState: 'synchronization_pending' },
  ];
  client.reconcile(data);
  expect(client.getSnapshot().phase).toBe('pending');
  data.entitlements.data.templates[0]!.ownershipState = 'owned';
  data.account.data.state = 'synchronization_pending';
  client.reconcile(data);
  expect(client.getSnapshot().phase).toBe('pending');
  data.account.data.state = 'synchronized';
  data.entitlements.data.templates[0]!.available = false;
  data.entitlements.data.templates[0]!.assetVersion = 2;
  client.reconcile(data);
  expect(client.getSnapshot()).toMatchObject({ phase: 'confirmed', attempt: null });
  expect(redemptionBlock(data, item)).toBe('Ownership is already recorded.');
});
it('reconciles an unknown result from canonical ownership without posting again', async () => {
  const { send, client } = await setup();
  client.prepare(resources(), item.id);
  send.mockRejectedValueOnce(new TypeError());
  await client.redeem(true);
  const data = resources();
  data.entitlements.data.templates = [{ ...item, owned: true, ownershipState: 'owned' }];
  client.reconcile(data);
  expect(client.getSnapshot().phase).toBe('confirmed');
  expect(send).toHaveBeenCalledTimes(2);
});
it.each([
  'owned',
  'pending',
  'unavailable',
  'unpriced',
  'insufficient',
  'restricted',
  'unknown-balance',
])('blocks %s before any redemption request', async (mode) => {
  const { send, client } = await setup(),
    data = resources(),
    row = data.catalogue.data.templates[0]!;
  if (mode === 'owned') row.owned = true;
  if (mode === 'pending') row.ownershipState = 'synchronization_pending';
  if (mode === 'unavailable') row.available = false;
  if (mode === 'unpriced') {
    row.amount = null;
    row.priceRevision = null;
  }
  if (mode === 'insufficient') data.account.data.spendableBalance = '24';
  if (mode === 'restricted') data.account.data.redemptionAllowed = false;
  if (mode === 'unknown-balance') data.account.data.spendableBalance = null;
  expect(() => client.prepare(data, item.id)).toThrow(TemplateError);
  expect(send).toHaveBeenCalledTimes(1);
});
it('accepts a configured zero price, and verifies already-owned responses without a charge', async () => {
  const { send, client } = await setup(),
    data = resources();
  data.catalogue.data.templates[0]!.amount = '0';
  client.prepare(data, item.id);
  send.mockResolvedValueOnce(
    json(envelope({ templateId: item.id, state: 'already_owned', charged: '0' })),
  );
  await client.redeem(true);
  expect(client.getSnapshot().phase).toBe('pending');
});
it('discards private command intent and fences a late response on authority loss', async () => {
  const { send, client, session } = await setup();
  client.prepare(resources(), item.id);
  let settle!: (response: Response) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const running = client.redeem(true);
  session.stop();
  settle(json(envelope(pending)));
  await running;
  expect(client.getSnapshot().phase).toBe('idle');
  expect(client.getSnapshot().attempt).toBeNull();
  await expect(client.redeem(true)).rejects.toBeInstanceOf(TemplateError);
});
