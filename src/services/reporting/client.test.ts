import { afterEach, expect, it, vi } from 'vitest';
import { createCreatorSession, type CreatorSession } from '@/services/creator-session/index';
import {
  DashboardResponseSchema,
  RoundAnalyticsResponseSchema,
  ChallengeResponseSchema,
  CompletionResponseSchema,
} from '@/services/contracts/index';
import { createReportingClient, ReportingError, reportingQuery } from './client';
import { moneyText } from './presentation';
import {
  dashboardFixture,
  analyticsFixture,
  reportingChallenge,
  declarationFixture,
  syntheticReportingSession,
  reportingIds as ids,
  stamp,
} from './fixture.test-helper';
const envelope = (data: unknown) => ({ schemaVersion: 1, serverTime: stamp, data });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sessions: CreatorSession[] = [];
async function setup() {
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(json(syntheticReportingSession)),
    session = createCreatorSession({ origin: 'https://api.example.test', fetcher: send });
  sessions.push(session);
  session.start();
  await session.inspect();
  return { send, session, client: createReportingClient(session) };
}
afterEach(() => {
  sessions.forEach((session) => session.stop());
  sessions.length = 0;
});
it('synthetic reporting fixtures satisfy all exact pinned contracts', () => {
  expect(DashboardResponseSchema.safeParse(envelope(dashboardFixture())).success).toBe(true);
  expect(RoundAnalyticsResponseSchema.safeParse(envelope(analyticsFixture())).success).toBe(true);
  expect(ChallengeResponseSchema.safeParse(envelope(reportingChallenge())).success).toBe(true);
  expect(CompletionResponseSchema.safeParse(declarationFixture()).success).toBe(true);
});
it.each([
  { timeZone: 'Not/AZone' },
  { timeZone: 'UTC', fromDate: '2026-10-01' },
  { timeZone: 'UTC', fromDate: '2026-02-30', throughDate: '2026-03-01' },
  { timeZone: 'UTC', fromDate: '2026-10-30', throughDate: '2026-10-01' },
  { timeZone: 'UTC', broadcastId: 'other-owner' },
])('rejects invalid reporting selection without transport: %j', async (input) => {
  const { client, send } = await setup();
  expect(() => reportingQuery(input)).toThrow(ReportingError);
  await expect(client.summary(input, new AbortController().signal)).rejects.toBeInstanceOf(
    ReportingError,
  );
  expect(send).toHaveBeenCalledTimes(1);
});
it('preserves exact large amounts, zero and unknown adjustment without floating arithmetic', () => {
  expect(moneyText('9007199254740993', 'EUR')).toBe('90071992547409.93 EUR');
  expect(moneyText('0', 'USD')).toBe('0.00 USD');
  expect(moneyText(null, 'EUR')).toBe('Unavailable');
  expect(moneyText('100', 'JPY')).toBe('100 minor units · JPY');
});
it('sends civil dates/timezone unchanged for a daylight-saving interval', async () => {
  const { client, send } = await setup(),
    data = dashboardFixture();
  data.period = {
    ...data.period,
    timeZone: 'Europe/Warsaw',
    fromDate: '2026-03-29',
    throughDate: '2026-03-29',
    startInclusive: '2026-03-28T23:00:00.000Z',
    endExclusive: '2026-03-29T22:00:00.000Z',
  };
  send.mockResolvedValueOnce(json(envelope(data)));
  const result = await client.summary(
    { timeZone: 'Europe/Warsaw', fromDate: '2026-03-29', throughDate: '2026-03-29' },
    new AbortController().signal,
  );
  expect(result.data.period.endExclusive).toBe('2026-03-29T22:00:00.000Z');
  expect(send.mock.calls[1]![0]).toContain(
    'timeZone=Europe%2FWarsaw&fromDate=2026-03-29&throughDate=2026-03-29',
  );
});
it('rejects another reporting selection in an otherwise valid response', async () => {
  const { client, send } = await setup();
  send.mockResolvedValueOnce(json(envelope(dashboardFixture())));
  await expect(
    client.summary({ timeZone: 'UTC', broadcastId: ids.broadcast }, new AbortController().signal),
  ).rejects.toBeInstanceOf(ReportingError);
});
it('rejects invalid opaque cursor and malformed IDs before reads', async () => {
  const { client, send } = await setup();
  await expect(
    client.history(false, 'https://foreign.test', new AbortController().signal),
  ).rejects.toBeInstanceOf(ReportingError);
  await expect(client.challenge('bad', new AbortController().signal)).rejects.toBeInstanceOf(
    ReportingError,
  );
  await expect(client.analytics('bad', new AbortController().signal)).rejects.toBeInstanceOf(
    ReportingError,
  );
  expect(send).toHaveBeenCalledTimes(1);
});
it('rejects a foreign challenge and round projection', async () => {
  const { client, send } = await setup(),
    challenge = reportingChallenge(),
    analytics = analyticsFixture();
  challenge.id = ids.other;
  analytics.roundId = ids.other;
  send
    .mockResolvedValueOnce(json(envelope(challenge)))
    .mockResolvedValueOnce(json(envelope(analytics)));
  await expect(
    client.challenge(ids.challenge, new AbortController().signal),
  ).rejects.toBeInstanceOf(ReportingError);
  await expect(client.analytics(ids.round, new AbortController().signal)).rejects.toBeInstanceOf(
    ReportingError,
  );
});
it('uses performance revision 1 rather than projection version 2 and binds authority zero', async () => {
  const { client } = await setup(),
    challenge = reportingChallenge();
  challenge.version = 2;
  challenge.performanceAuthority = {
    version: 1,
    revision: 0,
    authorizationId: null,
    originalBroadcastId: ids.broadcast,
    broadcastId: ids.broadcast,
  };
  const attempt = client.prepare(challenge);
  expect(attempt.input).toEqual({
    expectedVersion: 1,
    termsVersion: ids.terms,
    expectedPerformanceRevision: 0,
  });
  expect(Object.isFrozen(attempt.input)).toBe(true);
});
it.each(['twitch', 'youtube', 'kick'] as const)(
  '%s keeps 201/200 deliberate replay on the identical body/key',
  async (provider) => {
    const { client, send } = await setup(),
      challenge = reportingChallenge(),
      ack = declarationFixture();
    challenge.stream.provider = provider;
    ack.data.provider = provider;
    const attempt = client.prepare(challenge);
    send.mockResolvedValueOnce(json(ack, 201)).mockResolvedValueOnce(json(ack, 200));
    await client.declare(attempt);
    await client.declare(attempt);
    for (const [, options] of send.mock.calls.slice(1)) {
      expect(options?.body).toBe(JSON.stringify(attempt.input));
      expect(new Headers(options?.headers).get('Idempotency-Key')).toBe(attempt.key);
    }
  },
);
it('validates an authorized continuation acknowledgement exactly', async () => {
  const { client, send } = await setup(),
    challenge = reportingChallenge();
  challenge.version = 2;
  challenge.performanceAuthority = {
    version: 1,
    revision: 1,
    authorizationId: ids.other,
    originalBroadcastId: ids.broadcast,
    broadcastId: ids.round,
  };
  const attempt = client.prepare(challenge),
    ack = declarationFixture();
  ack.schemaVersion = 2;
  ack.data = {
    ...ack.data,
    broadcastId: ids.round,
    performanceAuthorityRevision: 1,
    continuationId: ids.other,
  };
  send.mockResolvedValueOnce(json(ack, 201));
  expect((await client.declare(attempt)).broadcastId).toBe(ids.round);
});
it('rejects an acknowledgement for another authorized stream', async () => {
  const { client, send } = await setup(),
    attempt = client.prepare(reportingChallenge()),
    ack = declarationFixture();
  ack.data.broadcastId = ids.other;
  send.mockResolvedValueOnce(json(ack, 201));
  await expect(client.declare(attempt)).rejects.toBeInstanceOf(ReportingError);
});
it.each(['pending', 'unsuccessful'] as const)(
  'cannot prepare a %s challenge declaration',
  async (state) => {
    const { client, send } = await setup(),
      challenge = reportingChallenge();
    challenge.funding.state = state;
    expect(() => client.prepare(challenge)).toThrow(ReportingError);
    expect(send).toHaveBeenCalledTimes(1);
  },
);
it('cannot prepare restricted content or an ambiguous continuation', async () => {
  const { client } = await setup(),
    challenge = reportingChallenge();
  challenge.contentAvailability = 'unavailable';
  expect(() => client.prepare(challenge)).toThrow(ReportingError);
  challenge.contentAvailability = 'available';
  challenge.performanceAuthority = {
    version: 1,
    revision: 1,
    authorizationId: null,
    originalBroadcastId: ids.broadcast,
    broadcastId: ids.round,
  };
  expect(() => client.prepare(challenge)).toThrow(ReportingError);
});
it('rejects fabricated receipt and overlapping commands without another POST', async () => {
  const { client, send } = await setup(),
    attempt = client.prepare(reportingChallenge());
  await expect(client.declare({ ...attempt })).rejects.toBeInstanceOf(ReportingError);
  let finish!: (value: Response) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = client.declare(attempt);
  await expect(client.declare(attempt)).rejects.toBeInstanceOf(ReportingError);
  finish(json(declarationFixture(), 201));
  await pending;
  expect(send).toHaveBeenCalledTimes(2);
});
it('does not automatically retry uncertain declarations', async () => {
  const { client, send } = await setup(),
    attempt = client.prepare(reportingChallenge());
  send.mockRejectedValueOnce(new TypeError('private error'));
  await expect(client.declare(attempt)).rejects.toBeInstanceOf(ReportingError);
  expect(send).toHaveBeenCalledTimes(2);
});
it('fences late read results and prior-authority receipts', async () => {
  const { client, session, send } = await setup(),
    attempt = client.prepare(reportingChallenge());
  let finish!: (value: Response) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = client.challenge(ids.challenge, new AbortController().signal);
  session.stop();
  finish(json(envelope(reportingChallenge())));
  await expect(pending).rejects.toBeInstanceOf(ReportingError);
  await expect(client.declare(attempt)).rejects.toBeInstanceOf(ReportingError);
});
