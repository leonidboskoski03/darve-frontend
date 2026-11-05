import { afterEach, expect, it, vi } from 'vitest';
import { createCreatorSession, type CreatorSession } from '@/services/creator-session/index';
import { createReceivingClient, receivingUncertain } from './index';

const origin = 'http://127.0.0.1:3310';
const expiry = '2099-01-01T00:00:00.000Z';
const signedIn = {
  authenticated: true,
  user: {
    id: '11223344-1234-4234-8234-112233445566',
    displayName: 'Synthetic creator',
    termsStatus: {
      status: 'unconfigured',
      requiredVersion: null,
      acceptedVersion: null,
      acceptedAt: null,
    },
  },
  expiresAt: expiry,
  csrfToken: 'a'.repeat(43),
};
const status = {
  environment: 'test',
  state: 'not_connected',
  version: null,
  country: null,
  currencies: [],
  observedAt: null,
  validUntil: null,
};
const paypal = { ...status, walletActive: false, cardsActive: false };
const envelope = (data: unknown) => ({
  schemaVersion: 1,
  serverTime: '2026-11-05T00:00:00.000Z',
  data,
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const sessions: CreatorSession[] = [];
async function setup() {
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(json(signedIn));
  const session = createCreatorSession({ origin, fetcher: send });
  sessions.push(session);
  session.start();
  await session.inspect();
  return { send, session, client: createReceivingClient(session) };
}
afterEach(() => {
  sessions.splice(0).forEach((session) => session.stop());
});

it('keeps provider statuses distinct and parses the exact revocation responses', async () => {
  const { client, send } = await setup();
  const revoked = { ...paypal, state: 'revoked', version: 8 };
  send
    .mockResolvedValueOnce(json(envelope({ ...status, state: 'unconfigured' })))
    .mockResolvedValueOnce(json(envelope(paypal)))
    .mockResolvedValueOnce(json(envelope(status)))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(json(envelope(revoked)));
  expect((await client.stripeStatus()).data.state).toBe('unconfigured');
  expect((await client.paypalStatus()).data).toEqual(paypal);
  expect((await client.refreshStripe()).data).toEqual(status);
  await expect(client.revokeStripe(7)).resolves.toBeUndefined();
  expect((await client.revokePayPal(7)).data).toEqual(revoked);
  expect(send.mock.calls.slice(1).map(([url, req]) => [url, req?.method, req?.body])).toEqual([
    [origin + '/api/payment-accounts/stripe', 'GET', undefined],
    [origin + '/api/payment-accounts/paypal', 'GET', undefined],
    [origin + '/api/payment-accounts/stripe/refresh', 'POST', '{}'],
    [origin + '/api/payment-accounts/stripe', 'DELETE', '{"expectedVersion":7}'],
    [origin + '/api/payment-accounts/paypal', 'DELETE', '{"expectedVersion":7}'],
  ]);
  for (const [, request] of send.mock.calls.slice(3)) {
    expect(new Headers(request?.headers).get('X-CSRF-Token')).toBe(signedIn.csrfToken);
    expect(request?.credentials).toBe('include');
  }
});

it('holds the exact reviewed body and key on failure until explicitly retried', async () => {
  const { client, send } = await setup();
  const attempt = client.preparePayPal('US', true);
  send.mockRejectedValueOnce(new Error('private'));
  const problem: unknown = await client.onboardPayPal(attempt).catch((error: unknown) => error);
  expect(receivingUncertain(problem)).toBe(true);
  expect(send).toHaveBeenCalledTimes(2);
  send.mockResolvedValueOnce(json(envelope({ status: paypal, url: null })));
  await expect(client.onboardPayPal(attempt)).resolves.toMatchObject({ kind: 'status' });
  expect(
    send.mock.calls
      .slice(1)
      .map(([, req]) => [req?.body, new Headers(req?.headers).get('Idempotency-Key')]),
  ).toEqual([
    ['{"country":"US","shareDataConsent":true}', attempt.key],
    ['{"country":"US","shareDataConsent":true}', attempt.key],
  ]);
  expect(Object.isFrozen(attempt.input)).toBe(true);
  await expect(client.onboardPayPal({ ...attempt })).rejects.toMatchObject({
    problem: { code: 'INVALID_RECEIVING_INPUT' },
  });
  expect(() => client.preparePayPal('US', false)).toThrow();
  expect(() => client.prepareStripe('us')).toThrow();
  await expect(client.revokeStripe(0)).rejects.toMatchObject({
    problem: { code: 'INVALID_RECEIVING_INPUT' },
  });
  expect(send).toHaveBeenCalledTimes(3);
});

it('separates 202 reconciliation, Stripe onboarding fragments, and existing-account redirects', async () => {
  const { client, send } = await setup();
  const stripe = client.prepareStripe('US'),
    existing = client.prepareStripeExisting('US');
  const stripeUrl = 'https://connect.stripe.com/r/synthetic#opaque';
  const oauthUrl =
    'https://connect.stripe.com/oauth/authorize?redirect_uri=' +
    encodeURIComponent(origin + '/api/payment-accounts/stripe/oauth/callback');
  send
    .mockResolvedValueOnce(
      json(
        envelope({
          status: { ...status, state: 'reconciliation_required' },
          url: null,
          expiresAt: null,
        }),
        202,
      ),
    )
    .mockResolvedValueOnce(json(envelope({ status, url: stripeUrl, expiresAt: expiry })))
    .mockResolvedValueOnce(
      json({ data: { state: 'already_connected', nextAction: null, expiresAt: null } }, 202),
    )
    .mockResolvedValueOnce(
      json({
        data: {
          state: 'authorization_required',
          nextAction: { type: 'redirect', url: oauthUrl },
          expiresAt: expiry,
        },
      }),
    );
  await expect(client.onboardStripe(stripe)).resolves.toMatchObject({ kind: 'pending' });
  await expect(client.onboardStripe(stripe)).resolves.toMatchObject({
    kind: 'redirect',
    url: stripeUrl,
  });
  await expect(client.connectExistingStripe(existing)).resolves.toMatchObject({
    kind: 'pending',
    state: 'already_connected',
  });
  await expect(client.connectExistingStripe(existing)).resolves.toMatchObject({
    kind: 'redirect',
    url: oauthUrl,
  });
});

it('rejects unsafe provider links, callback mismatches and expired or pending capabilities', async () => {
  const { client, send } = await setup();
  const stripe = client.prepareStripe('US'),
    existing = client.prepareStripeExisting('US'),
    pp = client.preparePayPal('US', true);
  for (const url of [
    'https://stripe.example.invalid/r/token',
    'https://account@connect.stripe.com/r/token',
    'https://connect.stripe.com:444/r/token',
  ]) {
    send.mockResolvedValueOnce(json(envelope({ status, url, expiresAt: expiry })));
    await expect(client.onboardStripe(stripe)).rejects.toMatchObject({
      problem: { code: 'INVALID_RECEIVING_HANDOFF' },
    });
  }
  send.mockResolvedValueOnce(
    json(
      envelope({
        status,
        url: 'https://connect.stripe.com/r/synthetic',
        expiresAt: '2020-01-01T00:00:00.000Z',
      }),
    ),
  );
  await expect(client.onboardStripe(stripe)).rejects.toMatchObject({
    problem: { code: 'INVALID_RECEIVING_HANDOFF' },
  });
  send.mockResolvedValueOnce(
    json({
      data: {
        state: 'authorization_required',
        expiresAt: expiry,
        nextAction: {
          type: 'redirect',
          url: 'https://connect.stripe.com/oauth/authorize?redirect_uri=https://wrong.invalid',
        },
      },
    }),
  );
  await expect(client.connectExistingStripe(existing)).rejects.toMatchObject({
    problem: { code: 'INVALID_RECEIVING_HANDOFF' },
  });
  for (const url of [
    'https://www.paypal.com/bizsignup/partner/entry',
    'https://www.sandbox.paypal.com/other',
    'https://www.sandbox.paypal.com/bizsignup/partner/entry#wrong',
  ]) {
    send.mockResolvedValueOnce(json(envelope({ status: paypal, url })));
    await expect(client.onboardPayPal(pp)).rejects.toMatchObject({
      problem: { code: 'INVALID_RECEIVING_HANDOFF' },
    });
  }
});

it('rejects concurrent commands and discards a response that arrives after authority changes', async () => {
  const { client, session, send } = await setup();
  let resolve!: (response: Response) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = client.refreshPayPal();
  await expect(client.revokeStripe(2)).rejects.toMatchObject({
    problem: { code: 'RECEIVING_COMMAND_IN_PROGRESS' },
  });
  session.stop();
  resolve(json(envelope(paypal)));
  await expect(pending).rejects.toMatchObject({ problem: { code: 'AUTHORITY_CHANGED' } });
  await expect(client.stripeStatus()).rejects.toMatchObject({
    problem: { code: 'AUTHORITY_CHANGED' },
  });
  expect(send).toHaveBeenCalledTimes(2);
});
