import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { startLocalApi } from './local-api.mjs';

const origin = 'http://127.0.0.1:4175';
const options = {
  backend: '../tmp/backend-f06-checkout',
  origins: [origin],
  task: 'f03-04',
  terms: true,
};
const checks = [];
const pass = (name) => {
  checks.push(name);
  console.log('PASS ' + name);
};
let api,
  browser,
  vite,
  result,
  phase = 'startup';
async function creator() {
  const actor = await api.seedSession({ expiresInMs: 300_000 });
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    const destination = new URL(route.request().url()).origin;
    return [origin, api.apiOrigin].includes(destination) ? route.continue() : route.abort();
  });
  await context.addCookies([
    {
      name: 'darve_session',
      value: actor.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await context.newPage();
  await page.goto(origin + '/integrations');
  await expect(page.getByRole('heading', { name: 'Read the current account terms' })).toBeVisible();
  await page.getByRole('checkbox', { name: /I have read and accept/ }).check();
  await page.getByRole('button', { name: 'Accept and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your streaming accounts' })).toBeVisible();
  await page.evaluate(async (apiOrigin) => {
    const { createReceivingClient } = await import('/src/services/receiving/index.ts');
    const { createCreatorSession } = await import('/src/services/creator-session/index.ts');
    const session = createCreatorSession({ origin: apiOrigin });
    session.start();
    await session.inspect();
    globalThis.receivingTest = { session, client: createReceivingClient(session) };
  }, api.apiOrigin);
  return { context, page };
}

try {
  api = await startLocalApi(options);
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  vite = await createServer({
    mode: 'acceptance-receiving',
    envDir: false,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 4175, strictPort: true, hmr: false },
  });
  await vite.listen();
  browser = await chromium.launch();
  phase = 'unconfigured';
  let { context, page } = await creator();
  assert.deepEqual(
    await page.evaluate(async () => {
      const { client } = globalThis.receivingTest;
      const stripe = await client.stripeStatus(),
        paypal = await client.paypalStatus();
      const denied = await client.refreshStripe().then(
        () => null,
        (error) => error.problem.status,
      );
      return [stripe.data.state, paypal.data.state, denied];
    }),
    ['unconfigured', 'unconfigured', 503],
  );
  await context.close();
  await api.close();
  api = undefined;
  pass('unconfigured status and unavailable refresh on the real API');
  phase = 'configured startup';
  api = await startLocalApi({ ...options, receiving: true, build: false });
  ({ context, page } = await creator());
  phase = 'Stripe onboarding';
  const requests = [];
  let drop = true;
  const stripeEndpoint = api.apiOrigin + '/api/payment-accounts/stripe/onboarding';
  await page.route(stripeEndpoint, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }
    requests.push({ key: request.headers()['idempotency-key'], body: request.postData() });
    if (drop) {
      drop = false;
      const response = await route.fetch({ maxRedirects: 0 });
      await route.abort('failed');
      assert.equal(response.status(), 200);
    } else await route.continue();
  });
  assert.deepEqual(
    await page.evaluate(async () => {
      const { client } = globalThis.receivingTest;
      const attempt = client.prepareStripe('US');
      globalThis.receivingTest.stripeAttempt = attempt;
      return [
        (await client.stripeStatus()).data.state,
        await client.onboardStripe(attempt).then(
          () => null,
          (e) => e.problem.category,
        ),
      ];
    }),
    ['not_connected', 'network'],
  );
  assert.equal(requests.length, 1);
  assert.equal(api.receivingCounts.stripeCreates, 1);
  assert.deepEqual(
    await page.evaluate(async () => {
      const { client, stripeAttempt } = globalThis.receivingTest;
      const handoff = await client.onboardStripe(stripeAttempt);
      const verified = await client.refreshStripe();
      return [
        handoff.kind,
        handoff.kind === 'redirect' && new URL(handoff.url).hash === '#opaque',
        verified.data.state,
      ];
    }),
    ['redirect', true, 'ready'],
  );
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(api.receivingCounts.stripeCreates, 1);
  await page.unroute(stripeEndpoint);
  pass('Stripe committed lost response and deliberate same-key retry create one binding');
  phase = 'Stripe revoke and PayPal';
  assert.deepEqual(
    await page.evaluate(async () => {
      const { client } = globalThis.receivingTest;
      const stripe = (await client.stripeStatus()).data;
      const stale = await client.revokeStripe(stripe.version - 1).then(
        () => null,
        (e) => [e.problem.status, e.problem.code],
      );
      await client.revokeStripe(stripe.version);
      const revoked = (await client.stripeStatus()).data.state;
      const paypal = client.preparePayPal('US', true);
      const onboard = await client.onboardPayPal(paypal);
      const resumed = await client.onboardPayPal(paypal);
      const ready = (await client.refreshPayPal()).data;
      const paypalStale = await client.revokePayPal(ready.version - 1).then(
        () => null,
        (e) => [e.problem.status, e.problem.code],
      );
      const removed = (await client.revokePayPal(ready.version)).data;
      return [
        stale,
        revoked,
        onboard.kind,
        resumed.kind,
        ready.state,
        ready.walletActive,
        ready.cardsActive,
        paypalStale,
        removed.state,
      ];
    }),
    [
      [409, 'STALE_VERSION'],
      'revoked',
      'redirect',
      'redirect',
      'ready',
      true,
      false,
      [409, 'STALE_VERSION'],
      'revoked',
    ],
  );
  assert.equal(api.receivingCounts.paypalReferrals, 1);
  pass('Stripe 204 and PayPal JSON revocation, stale denial and wallet/card distinction');
  phase = 'Stripe reconciliation';
  ({ context, page } = await creator());
  assert.deepEqual(
    await page.evaluate(async () => {
      const { client } = globalThis.receivingTest;
      const attempt = client.prepareStripe('CA');
      const failed = await client.onboardStripe(attempt).then(
        () => null,
        (e) => e.problem.status,
      );
      const pending = await client.onboardStripe(attempt);
      return [failed, pending.kind, pending.status.state, 'url' in pending];
    }),
    [503, 'pending', 'reconciliation_required', false],
  );
  assert.equal(api.receivingCounts.stripeCreates, 2);
  await context.close();
  pass('uncertain Stripe creation returns a link-free reconciliation response');
  phase = 'existing Stripe';
  ({ context, page } = await creator());
  const handoff = await page.evaluate(async () => {
    const { client } = globalThis.receivingTest;
    const attempt = client.prepareStripeExisting('US');
    globalThis.receivingTest.existing = attempt;
    const started = await client.connectExistingStripe(attempt);
    const retry = await client.connectExistingStripe(attempt);
    if (started.kind !== 'redirect' || retry.kind !== 'pending' || retry.state !== 'pending')
      throw Error('Unexpected setup state.');
    return new URL(started.url).searchParams.get('state');
  });
  assert.match(handoff, /^[A-Za-z0-9_-]{43}$/);
  const callback = await context.request.get(
    api.apiOrigin +
      '/api/payment-accounts/stripe/oauth/callback?' +
      new URLSearchParams({ state: handoff, code: 'ac_synthetic' }),
    { maxRedirects: 0 },
  );
  assert.equal(callback.status(), 303);
  assert.equal(callback.headers().location, origin + '/account/payments');
  assert.deepEqual(
    await page.evaluate(async () => {
      const { client, existing } = globalThis.receivingTest;
      const repeat = await client.connectExistingStripe(existing);
      return [repeat.kind, repeat.state, (await client.stripeStatus()).data.state];
    }),
    ['pending', 'already_connected', 'ready'],
  );
  assert.equal(api.receivingCounts.stripeExchanges, 1);
  pass('Stripe existing-account start, pending retry, server callback and authoritative status');
  phase = 'authority';
  assert.equal(
    await page.evaluate(async () => {
      const { client, session } = globalThis.receivingTest;
      await session.logout();
      return client.stripeStatus().then(
        () => null,
        (error) => error.problem.code,
      );
    }),
    'AUTHORITY_CHANGED',
  );
  pass('logged-out client cannot reuse receiving authority');
  result = {
    source: api.source,
    migrations: api.migrations,
    checks,
    controlledProviderPorts: true,
    externalProviderCalls: false,
    counts: api.receivingCounts,
  };
} catch (error) {
  console.error('FAIL ' + phase + ' ' + error.name);
  console.error(
    error.stack?.split('\n').find((line) => line.includes('local-receiving-acceptance.mjs')) ?? '',
  );
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled([browser?.close(), vite?.close(), api?.close()]);
  if (cleanup.some((item) => item.status === 'rejected')) {
    console.error('Receiving acceptance cleanup requires inspection.');
    process.exitCode = 1;
  }
  if (result && !process.exitCode) {
    mkdirSync('artifacts.local/f03-04', { recursive: true });
    writeFileSync(
      'artifacts.local/f03-04/acceptance.json',
      JSON.stringify({ ...result, cleanup: true }, null, 2),
    );
  }
}
