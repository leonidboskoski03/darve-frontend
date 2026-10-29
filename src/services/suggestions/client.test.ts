import { afterEach, expect, it, vi } from 'vitest';
import { createCreatorSession, type CreatorSession } from '@/services/creator-session/index';
import { SuggestionPageResponseSchema, ChallengeResponseSchema } from '@/services/contracts/index';
import { createSuggestionClient, ReviewError, uncertainReview } from './client';
import { failure } from '@/services/api/index';
import {
  reviewFixture,
  acceptedFixture,
  challengeFixture,
  reviewIds as ids,
} from './fixture.test-helper';
const envelope = (data: unknown) => ({
  schemaVersion: 1,
  serverTime: '2026-10-29T12:00:00.000Z',
  data,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sessions: CreatorSession[] = [];
const syntheticSession = {
  authenticated: true,
  user: {
    id: ids.source,
    displayName: 'Synthetic reviewer',
    termsStatus: {
      status: 'accepted',
      documentId: 'synthetic',
      requiredVersion: 'v1',
      classification: 'development',
      contentHash: 'a'.repeat(64),
      acceptedVersion: 'v1',
      acceptedAt: '2026-10-29T12:00:00.000Z',
    },
  },
  expiresAt: '2030-01-01T00:00:00.000Z',
  csrfToken: 'a'.repeat(43),
};
const terms = { decimal: '25.50', currency: 'EUR', seconds: '600' };
async function setup() {
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(json(syntheticSession));
  const session = createCreatorSession({ origin: 'https://api.example.test', fetcher: send });
  sessions.push(session);
  session.start();
  await session.inspect();
  return { send, session, client: createSuggestionClient(session) };
}
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions.length = 0;
});
it('synthetic review and challenge fixtures satisfy pinned public contracts', () => {
  expect(SuggestionPageResponseSchema.safeParse(envelope(reviewFixture())).success).toBe(true);
  expect(ChallengeResponseSchema.safeParse(challengeFixture()).success).toBe(true);
});
it('preserves exact amounts above Number safe integer and freezes nested terms', async () => {
  const { client, send } = await setup(),
    page = reviewFixture();
  const attempt = client.prepare(page, page.items[0]!, { ...terms, decimal: '90071992547409.93' });
  expect(attempt.input.goal.amountMinor).toBe('9007199254740993');
  expect(Object.isFrozen(attempt.input.goal)).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
});
it.each(['0', '-1', '1e2', '01.00', '1.001', '92233720368547758.08'])(
  'rejects invalid exact goal %s without a request',
  async (decimal) => {
    const { client, send } = await setup(),
      page = reviewFixture();
    expect(() => client.prepare(page, page.items[0]!, { ...terms, decimal })).toThrow(ReviewError);
    expect(send).toHaveBeenCalledTimes(1);
  },
);
it.each(['0', '1.1', '2147483648', '1e2'])(
  'rejects invalid funding seconds %s',
  async (seconds) => {
    const { client } = await setup(),
      page = reviewFixture();
    expect(() => client.prepare(page, page.items[0]!, { ...terms, seconds })).toThrow(ReviewError);
  },
);
it('binds exact 201/200 replay to the same body, key and source publication', async () => {
  const { client, send } = await setup(),
    page = reviewFixture(),
    attempt = client.prepare(page, page.items[0]!, terms);
  send
    .mockResolvedValueOnce(json(envelope(acceptedFixture()), 201))
    .mockResolvedValueOnce(json(envelope(acceptedFixture()), 200));
  expect((await client.accept(attempt)).id).toBe(ids.challenge);
  await client.accept(attempt);
  for (const [, options] of send.mock.calls.slice(1)) {
    expect(options?.body).toBe(JSON.stringify(attempt.input));
    expect(new Headers(options?.headers).get('Idempotency-Key')).toBe(attempt.key);
  }
});
it('rejects foreign receipt and obsolete authority before writes', async () => {
  const { client, session, send } = await setup(),
    page = reviewFixture(),
    attempt = client.prepare(page, page.items[0]!, terms);
  await expect(client.accept({ ...attempt })).rejects.toBeInstanceOf(ReviewError);
  session.stop();
  await expect(client.accept(attempt)).rejects.toBeInstanceOf(ReviewError);
  expect(send).toHaveBeenCalledTimes(1);
});
it('does not replay an uncertain command automatically', async () => {
  const { client, send } = await setup(),
    page = reviewFixture(),
    attempt = client.prepare(page, page.items[0]!, terms);
  send.mockRejectedValueOnce(new TypeError('private transport detail'));
  await expect(client.accept(attempt)).rejects.toBeInstanceOf(ReviewError);
  expect(send).toHaveBeenCalledTimes(2);
});
it('rejects an acknowledgement with different financial terms', async () => {
  const { client, send } = await setup(),
    page = reviewFixture(),
    attempt = client.prepare(page, page.items[0]!, terms),
    ack = acceptedFixture();
  ack.goal.amountMinor = '2551';
  send.mockResolvedValueOnce(json(envelope(ack), 201));
  await expect(client.accept(attempt)).rejects.toBeInstanceOf(ReviewError);
});
it('rejects a foreign round and mismatched cursor publication', async () => {
  const { client, send } = await setup(),
    page = reviewFixture();
  page.items[0]!.roundId = ids.snapshot;
  send.mockResolvedValueOnce(json(envelope(page)));
  await expect(client.page(ids.round, null, new AbortController().signal)).rejects.toBeInstanceOf(
    ReviewError,
  );
  send.mockResolvedValueOnce(json(envelope(reviewFixture())));
  await expect(
    client.page(ids.round, ids.snapshot + '.1', new AbortController().signal),
  ).rejects.toBeInstanceOf(ReviewError);
});
it('sends explicit versioned disposition and rejects an impossible pair', async () => {
  const { client, send } = await setup(),
    item = reviewFixture().items[0]!;
  await expect(client.disposition(item, true, true)).rejects.toBeInstanceOf(ReviewError);
  send.mockResolvedValueOnce(json(envelope({ ...item, version: 2, pinned: true })));
  await client.disposition(item, true, false);
  expect(JSON.parse(send.mock.calls[1]![1]!.body as string)).toEqual({
    expectedVersion: 1,
    pinned: true,
    dismissed: false,
  });
});
it('rejects dismissed, accepted and superseded source reviews', async () => {
  const { client } = await setup();
  for (const change of ['dismissed', 'accepted', 'publication']) {
    const page = reviewFixture(),
      item = page.items[0]!;
    if (change === 'dismissed') item.dismissed = true;
    else if (change === 'accepted') item.selectedChallengeId = ids.challenge;
    else page.resultVersion = ids.snapshot;
    expect(() => client.prepare(page, item, terms)).toThrow(ReviewError);
  }
});

it('rejects a late response after the creator authority is disposed', async () => {
  const { client, session, send } = await setup();
  let finish!: (value: Response) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = client.page(ids.round, null, new AbortController().signal);
  session.stop();
  finish(json(envelope(reviewFixture())));
  await expect(pending).rejects.toBeInstanceOf(ReviewError);
});
it('prevents overlapping financial commands on one authority client', async () => {
  const { client, send } = await setup(),
    page = reviewFixture(),
    attempt = client.prepare(page, page.items[0]!, terms);
  let finish!: (value: Response) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = client.accept(attempt);
  await expect(client.accept(attempt)).rejects.toBeInstanceOf(ReviewError);
  finish(json(envelope(acceptedFixture()), 201));
  await pending;
  expect(send).toHaveBeenCalledTimes(2);
});
it('rejects another source challenge projection', async () => {
  const { client, send } = await setup(),
    value = challengeFixture();
  value.data.roundId = ids.source;
  send.mockResolvedValueOnce(json(value));
  await expect(
    client.challenge(ids.challenge, ids.round, ids.result + '.g1', new AbortController().signal),
  ).rejects.toBeInstanceOf(ReviewError);
});
it('distinguishes a definitive unconfigured policy from uncertain service failure', () => {
  expect(uncertainReview(new ReviewError(failure('http', 'POLICY_UNAVAILABLE', 503)))).toBe(false);
  expect(uncertainReview(new ReviewError(failure('http', 'SERVICE_UNAVAILABLE', 503)))).toBe(true);
});
