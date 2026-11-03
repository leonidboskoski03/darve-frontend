import { afterEach, expect, it, vi } from 'vitest';
import { createStaffAccess, type StaffAccess } from '@/services/staff-access/index';
import { createStaffSupportClient } from './client';
import {
  ids,
  staffSession,
  ticket,
  envelope,
  errorBody,
  recoveryFixture,
  recoveryChallenge,
} from './fixture.test-helper';
const active: StaffAccess[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function setup(owner = true) {
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
  const t = ticket();
  t.contexts = [{ kind: 'challenge', id: recoveryChallenge }];
  return { send, access, client: createStaffSupportClient(access), t };
}
afterEach(() => {
  active.splice(0).forEach((access) => access.stop());
  window.sessionStorage.clear();
});
it('binds recovery to current ticket context, policy, revision and exact frozen deadlines', async () => {
  const { client, send, t } = await setup(),
    data = recoveryFixture();
  send.mockResolvedValueOnce(json(envelope(data)));
  const read = await client.recovery(t, recoveryChallenge, new AbortController().signal),
    attempt = client.prepareRecovery(read, 'extension', {
      addedSeconds: '60',
      reason: ' Reviewed extension ',
    });
  expect(attempt.body).toMatchObject({
    expectedTicketRevision: 9,
    expectedContextRevision: 0,
    expectedAuthorityRevision: 5,
    expectedFundingRevision: 0,
    expectedPerformanceRevision: 0,
    expectedWindowRevision: 0,
    reason: 'Reviewed extension',
    addedSeconds: 60,
    confirmation: {
      challengeId: recoveryChallenge,
      previousDeadline: data.fundingWindow!.effectiveClosesAt,
      newDeadline: new Date(
        Date.parse(data.fundingWindow!.effectiveClosesAt) + 60000,
      ).toISOString(),
    },
  });
  expect(Object.isFrozen(attempt.body.confirmation)).toBe(true);
  expect(Object.isFrozen(read.data)).toBe(true);
  for (const addedSeconds of ['0', '-1', '1.5', '121', '01', '1e2'])
    expect(() =>
      client.prepareRecovery(read, 'extension', { addedSeconds, reason: 'Invalid seconds.' }),
    ).toThrow();
  expect(() =>
    client.prepareRecovery({ ...read }, 'extension', {
      addedSeconds: '60',
      reason: 'Unbranded read.',
    }),
  ).toThrow();
});
it.each(['SUPPORT', 'foreign', 'private', 'stale', 'disabled'] as const)(
  'denies %s recovery preparation without inventing configuration',
  async (condition) => {
    const { client, send, t } = await setup(condition !== 'SUPPORT');
    if (condition === 'SUPPORT') {
      await expect(
        client.recovery(t, recoveryChallenge, new AbortController().signal),
      ).rejects.toThrow();
      expect(send).toHaveBeenCalledTimes(2);
      return;
    }
    const data = recoveryFixture();
    const value =
      condition === 'foreign'
        ? { ...data, challengeId: ids.other }
        : condition === 'private'
          ? { ...data, credential: 'never-public' }
          : condition === 'stale'
            ? { ...data, contextRevision: 1 }
            : { state: 'disabled', ticketId: ids.ticket, challengeId: recoveryChallenge };
    send.mockResolvedValueOnce(json(envelope(value)));
    if (condition === 'disabled') {
      const read = await client.recovery(t, recoveryChallenge, new AbortController().signal);
      expect(() =>
        client.prepareRecovery(read, 'extension', {
          addedSeconds: '60',
          reason: 'Not configured.',
        }),
      ).toThrow();
    } else
      await expect(
        client.recovery(t, recoveryChallenge, new AbortController().signal),
      ).rejects.toThrow();
  },
);
it('uses only fresh verified replacement IDs and retains the immutable original broadcast', async () => {
  const { client, send, t } = await setup(),
    data = recoveryFixture();
  send.mockResolvedValueOnce(json(envelope(data)));
  const read = await client.recovery(t, recoveryChallenge, new AbortController().signal);
  expect(() =>
    client.prepareRecovery(read, 'continuation', {
      replacementId: ids.owner,
      reason: 'Arbitrary UUID.',
    }),
  ).toThrow();
  const attempt = client.prepareRecovery(read, 'continuation', {
    replacementId: ids.other,
    reason: 'Verified replacement.',
  });
  expect(attempt.body).toMatchObject({
    expectedPerformanceRevision: 0,
    replacementBroadcastId: ids.other,
    confirmation: { originalBroadcastId: ids.agent, replacementBroadcastId: ids.other },
  });
  const expired = recoveryFixture();
  expired.replacements[0]!.validUntil = new Date(Date.now() - 500).toISOString();
  send.mockResolvedValueOnce(json(envelope(expired)));
  const old = await client.recovery(t, recoveryChallenge, new AbortController().signal);
  expect(() =>
    client.prepareRecovery(old, 'continuation', {
      replacementId: ids.other,
      reason: 'Expired proof.',
    }),
  ).toThrow();
});
it('retries the same reviewed extension after an unknown result and rejects a mismatched acknowledgement', async () => {
  const { client, send, t } = await setup(),
    data = recoveryFixture();
  send.mockResolvedValueOnce(json(envelope(data)));
  const read = await client.recovery(t, recoveryChallenge, new AbortController().signal),
    attempt = client.prepareRecovery(read, 'extension', {
      addedSeconds: '60',
      reason: 'Reviewed request.',
    });
  const result = {
    schemaVersion: 1,
    data: {
      authorizationId: ids.owner,
      kind: 'extension',
      revision: 1,
      challengeId: recoveryChallenge,
      createdAt: new Date().toISOString(),
      authority: {
        version: 1,
        fundingWindow: {
          ...data.fundingWindow!,
          revision: 1,
          cumulativeSeconds: 60,
          effectiveClosesAt: new Date(
            Date.parse(data.fundingWindow!.effectiveClosesAt) + 60000,
          ).toISOString(),
        },
        performanceAuthority: data.performanceAuthority,
      },
    },
  };
  send.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(json(result));
  await expect(client.execute(attempt)).rejects.toThrow();
  await client.execute(attempt);
  const calls = send.mock.calls.slice(-2);
  expect(calls[0]![1]!.body).toBe(calls[1]![1]!.body);
  expect(new Headers(calls[0]![1]!.headers).get('Idempotency-Key')).toBe(attempt.key);
  expect(new Headers(calls[1]![1]!.headers).get('Idempotency-Key')).toBe(attempt.key);
  result.data.challengeId = ids.other;
  send.mockResolvedValueOnce(json(result));
  await expect(client.execute(attempt)).rejects.toMatchObject({
    problem: { category: 'protocol' },
  });
});
