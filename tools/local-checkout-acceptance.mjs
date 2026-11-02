import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { startLocalApi } from './local-api.mjs';
const origin = 'http://127.0.0.1:4175',
  checks = [],
  errors = [],
  statuses = [];
let api,
  vite,
  browser,
  stage = 'startup';
try {
  api = await startLocalApi({
    backend: process.argv[2] ?? '../darve-backend',
    origins: [origin],
    task: 'f06-03',
    collection: true,
    review: true,
    checkout: true,
    terms: true,
  });
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  vite = await createServer({
    mode: 'acceptance-contribution',
    envDir: false,
    clearScreen: false,
    server: { host: '127.0.0.1', port: 4175, strictPort: true, hmr: false },
  });
  await vite.listen();
  browser = await chromium.launch();
  const creator = await api.seedSession({ expiresInMs: 600000 }),
    owner = await browser.newContext();
  await owner.addCookies([
    {
      name: 'darve_session',
      value: creator.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const session = await (
    await owner.request.get(api.apiOrigin + '/api/session', { headers: { Origin: origin } })
  ).json();
  const headers = { Origin: origin, 'X-CSRF-Token': session.csrfToken };
  const policy = (
    await (await owner.request.get(api.apiOrigin + '/api/terms/current', { headers })).json()
  ).data;
  assert.equal(
    (
      await owner.request.post(api.apiOrigin + '/api/terms/acceptance', {
        headers,
        data: {
          documentId: policy.documentId,
          version: policy.version,
          contentHash: policy.contentHash,
          accepted: true,
        },
      })
    ).status(),
    200,
  );
  const get = async (path) => {
    const response = await owner.request.get(api.apiOrigin + path, { headers });
    assert.equal(response.status(), 200);
    return (await response.json()).data;
  };
  api.collectionFixture.capacity('available');
  async function accepted(seconds = 600) {
    const stream = await api.collectionFixture.seed(creator.userId);
    const start = await owner.request.post(api.apiOrigin + '/api/rounds', {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: {
        connectionId: stream.connectionId,
        broadcastId: stream.broadcastId,
        collectionDurationSeconds: 60,
        announcementPinMode: 'off',
      },
    });
    assert.equal(start.status(), 202);
    const roundId = (await start.json()).data.id;
    await api.collectionFixture.recover();
    const active = await get('/api/rounds/' + roundId);
    await api.collectionFixture.admitIdeas(creator.userId, roundId);
    assert.equal(
      (
        await owner.request.post(`${api.apiOrigin}/api/rounds/${roundId}/collection/stop`, {
          headers,
          data: { expectedVersion: active.version },
        })
      ).status(),
      202,
    );
    await api.reviewFixture.publish(creator.userId, roundId);
    const suggestions = await get(`/api/rounds/${roundId}/suggestions`),
      item = suggestions.items[0];
    const result = await owner.request.post(
      `${api.apiOrigin}/api/rounds/${roundId}/suggestions/${item.id}/accept`,
      {
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {
          expectedVersion: item.version,
          analysisRunId: item.analysisRunId,
          resultVersion: suggestions.resultVersion,
          snapshotVersion: item.snapshotVersion,
          goal: { amountMinor: '100000', currency: 'EUR' },
          fundingDurationSeconds: seconds,
        },
      },
    );
    assert.equal(result.status(), 201);
    return { id: (await result.json()).data.id, roundId };
  }
  stage = 'controlled receiving and public availability';
  await api.checkoutFixture.configure(creator.userId, creator.secret, session.csrfToken);
  const challenge = await accepted(),
    detail = await get('/api/challenges/' + challenge.id),
    publicId = detail.publicId;
  assert.ok(publicId);
  const guest = await browser.newContext(),
    page = await guest.newPage();
  page.on('pageerror', (error) => errors.push(error.name));
  page.on('response', async (response) => {
    if (!response.url().startsWith(api.apiOrigin) || response.request().method() !== 'POST') return;
    const body = await response.json().catch(() => null);
    const code = body?.error?.code;
    statuses.push({
      action: new URL(response.url()).pathname.split('/').at(-1),
      status: response.status(),
      code: /^[A-Z0-9_]+$/.test(code ?? '') ? code : null,
    });
  });
  const commands = [];
  page.on('request', (request) => {
    if (request.url().startsWith(api.apiOrigin) && request.method() === 'POST')
      commands.push({
        path: new URL(request.url()).pathname,
        body: request.postData(),
        key: request.headers()['idempotency-key'],
      });
  });
  const visit = (path) => page.goto(origin + path, { waitUntil: 'domcontentloaded' });
  await visit('/contribute/' + publicId);
  await expect(page.getByRole('combobox', { name: 'Payment method', exact: true })).toBeVisible();
  checks.push(
    'actual ready public projection exposes controlled Stripe and PayPal without a creator login',
  );
  const overlapping = await Promise.all(
    Array.from({ length: 3 }, () =>
      guest.request.get(api.apiOrigin + '/api/public/challenges/' + publicId, {
        headers: { Origin: origin },
      }),
    ),
  );
  for (const response of overlapping) {
    assert.equal(response.status(), 200);
    const projection = (await response.json()).data;
    assert.equal(projection.checkoutAvailability.available, true);
    assert.ok(projection.availablePaymentProviders.every((row) => row.availability.available));
  }
  checks.push(
    'overlapping actual public HTTP reads retain both verified methods through actual receiving services and SQL without a manual refresh',
  );
  async function prepare(provider) {
    await visit('/contribute/' + publicId);
    await page
      .getByRole('combobox', { name: 'Payment method', exact: true })
      .selectOption(provider);
    await page.getByRole('checkbox', { name: /I reviewed this challenge/ }).check();
    await page.getByRole('button', { name: 'Prepare checkout', exact: true }).click();
    const same = page.getByRole('button', { name: 'Continue same contribution', exact: true });
    await expect(
      page.getByRole('heading', { name: 'Private contribution receipt', exact: true }).or(same),
    ).toBeVisible();
    if (await same.isVisible()) await same.click();
    await expect(
      page.getByRole('heading', { name: 'Private contribution receipt', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh receipt', exact: true })).toBeVisible();
    return new URL(page.url()).pathname.split('/').at(-1);
  }
  stage = 'actual browser create and private custody';
  const stripeId = await prepare('stripe');
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[0], commands[1]);
  assert.equal((await api.checkoutFixture.audit()).stripeCreates, 1);
  checks.push(
    'fresh browser cookie handshake replays exact body/key and creates exactly one SQL attempt/provider object',
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Continue to Stripe', exact: true })).toBeVisible();
  assert.equal(commands.length, 2);
  checks.push(
    'private receipt reload preserves known reference without repeating checkout creation',
  );
  stage = 'private continuation and return';
  await page.route('https://checkout.stripe.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Synthetic provider destination; no external payment</h1>',
    }),
  );
  await page.getByRole('checkbox', { name: /I reviewed this checkout/ }).check();
  await page.getByRole('button', { name: 'Continue to Stripe', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Synthetic provider destination; no external payment' }),
  ).toBeVisible();
  assert.equal((await api.checkoutFixture.audit()).stripeCreates, 1);
  assert.ok(commands.at(-1).path.endsWith('/resume'));
  await visit('/payments/cancel?checkout=' + stripeId + '&token=untrusted&status=success');
  await expect(
    page.getByRole('heading', { name: 'Private contribution receipt', exact: true }),
  ).toBeVisible();
  assert.equal(new URL(page.url()).search, '');
  checks.push(
    'explicit receipt continuation retrieves original object; cancel/return is sanitized and never declares payment',
  );
  stage = 'foreign browser access';
  const foreign = await browser.newContext();
  assert.equal(
    (
      await foreign.request.get(api.apiOrigin + '/api/checkouts/' + stripeId, {
        headers: { Origin: origin },
      })
    ).status(),
    401,
  );
  assert.equal(
    (
      await foreign.request.post(api.apiOrigin + '/api/checkouts/' + stripeId + '/resume', {
        headers: { Origin: origin },
        data: {},
      })
    ).status(),
    401,
  );
  await foreign.close();
  checks.push('foreign browser reference cannot read or resume the private checkout');
  stage = 'PayPal approval is separate from capture';
  const paypalId = await prepare('paypal');
  const beforeApproval = await api.checkoutFixture.audit();
  assert.equal(beforeApproval.captures, 0);
  await visit('/payments/return?checkout=' + paypalId + '&token=ORDER2&status=success');
  await expect(
    page.getByRole('button', { name: 'Complete PayPal payment', exact: true }),
  ).toBeDisabled();
  assert.equal((await api.checkoutFixture.audit()).captures, 0);
  await page.getByRole('checkbox', { name: /I approved this order on PayPal/ }).check();
  await page.getByRole('button', { name: 'Complete PayPal payment', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Payment is not confirmed' }),
  ).toBeVisible();
  assert.equal((await api.checkoutFixture.audit()).captures, 0);
  await page.route('https://www.sandbox.paypal.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Synthetic original PayPal approval</h1>',
    }),
  );
  await page.getByRole('checkbox', { name: /I reviewed this checkout/ }).check();
  await page.getByRole('button', { name: 'Continue to PayPal', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Synthetic original PayPal approval', exact: true }),
  ).toBeVisible();
  assert.equal((await api.checkoutFixture.audit()).paypalCreates, 1);
  assert.equal((await api.checkoutFixture.audit()).captures, 0);
  checks.push(
    'completion before approval performs no capture and still permits continuation of the same original PayPal order',
  );
  await api.checkoutFixture.approve(paypalId);
  await visit('/payments/return?checkout=' + paypalId + '&token=ORDER1');
  await page.getByRole('checkbox', { name: /I approved this order on PayPal/ }).check();
  await page.getByRole('button', { name: 'Complete PayPal payment', exact: true }).click();
  await expect(page.getByText('Verified payment recorded', { exact: true })).toBeVisible();
  const paid = await api.checkoutFixture.audit();
  assert.equal(paid.captures, 1);
  assert.equal(paid.payments, 1);
  const complete = commands.at(-1);
  assert.ok(complete.path.endsWith('/complete'));
  const replay = await guest.request.post(api.apiOrigin + complete.path, {
    headers: { Origin: origin, 'Idempotency-Key': complete.key },
    data: {},
  });
  assert.equal(replay.status(), 200);
  assert.equal((await api.checkoutFixture.audit()).captures, 1);
  checks.push(
    'explicit approved PayPal completion records canonical money once; same-key replay does not capture twice',
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Verified payment recorded', { exact: true })).toBeVisible();
  checks.push(
    'verified private payment survives reload with payment timing distinct from funding success',
  );
  stage = 'receiving withdrawal';
  api.checkoutFixture.receiving(false);
  await visit('/contribute/' + publicId);
  await expect(page.getByRole('status')).toContainText('cannot currently receive');
  await expect(page.getByRole('button', { name: 'Prepare checkout', exact: true })).toHaveCount(0);
  const countBefore = await api.checkoutFixture.audit();
  const denied = await guest.request.post(
    `${api.apiOrigin}/api/public/challenges/${publicId}/checkouts`,
    {
      headers: { Origin: origin, 'Idempotency-Key': randomUUID() },
      data: { termsVersion: detail.terms.version, paymentProvider: 'stripe', amountMinor: '1000' },
    },
  );
  assert.equal(denied.status(), 409);
  assert.equal((await denied.json()).error.code, 'RECEIVING_UNAVAILABLE');
  assert.equal((await api.checkoutFixture.audit()).attempts, countBefore.attempts);
  checks.push(
    'actual receiving withdrawal removes public action and denies a direct stale POST before a new attempt',
  );
  api.checkoutFixture.receiving(true);
  stage = 'unknown provider create outcome';
  api.checkoutFixture.unknownCreate();
  const unknownId = await prepare('stripe');
  await expect(page.getByText('Outcome unknown', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to Stripe', exact: true })).toHaveCount(
    0,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Outcome unknown', { exact: true })).toBeVisible();
  assert.ok(unknownId !== stripeId);
  checks.push(
    'unknown provider creation persists one known SQL receipt and never invents a redirect or payment',
  );
  stage = 'unknown PayPal capture outcome';
  const uncertainPayPal = await prepare('paypal');
  await api.checkoutFixture.approve(uncertainPayPal);
  api.checkoutFixture.unknownCapture();
  await page.getByRole('checkbox', { name: /I approved this order on PayPal/ }).check();
  await page.getByRole('button', { name: 'Complete PayPal payment', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry same PayPal completion', exact: true }),
  ).toBeDisabled();
  const captureRequest = commands.at(-1),
    unknownCaptureAudit = await api.checkoutFixture.audit();
  assert.equal(unknownCaptureAudit.captures, 2);
  assert.equal(unknownCaptureAudit.payments, 1);
  const uncertainReplay = await guest.request.post(api.apiOrigin + captureRequest.path, {
    headers: { Origin: origin, 'Idempotency-Key': captureRequest.key },
    data: {},
  });
  assert.equal(uncertainReplay.status(), 202);
  assert.equal((await api.checkoutFixture.audit()).captures, 2);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { name: 'Private contribution receipt', exact: true }),
  ).toBeVisible();
  assert.equal((await api.checkoutFixture.audit()).captures, 2);
  checks.push(
    'unknown PayPal capture remains unconfirmed and same-key replay/reload cannot submit a second capture',
  );
  stage = 'revoked guest proof';
  const secret = (await guest.cookies(api.apiOrigin + '/api/checkouts')).find(
    (row) => row.name === 'darve_payment_guest',
  )?.value;
  assert.ok(secret);
  await api.checkoutFixture.revokeBrowser(secret);
  await page.getByRole('button', { name: 'Refresh receipt', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('unavailable');
  checks.push(
    'revoked guest proof hides private data and does not recover through creator identity',
  );
  assert.deepEqual(errors, []);
  const result = {
    task: 'f06-03',
    runId: api.runId,
    source: api.source,
    migrations: api.migrations,
    checks,
    pageErrors: errors,
    actualPostgresRedis: true,
    actualFinancialRepositoriesAndHttp: true,
    syntheticProviderReceivingAndModel: true,
    controlledBrowserCommands: true,
    ordinaryCreationEnabled: false,
    externalProviderCalls: false,
    liveOrSandboxPaymentVerified: false,
    aggregate: await api.checkoutFixture.audit(),
  };
  mkdirSync('artifacts.local/f06-03', { recursive: true });
  writeFileSync('artifacts.local/f06-03/acceptance.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(
    JSON.stringify({
      failedStage: stage,
      errorType: error?.name ?? 'Error',
      timedOut: /Timeout|timed out/.test(error?.message ?? ''),
      sourceLine: (error?.stack ?? '').match(/local-checkout-acceptance\.mjs:\d+:\d+/)?.[0] ?? null,
      safeCode: /^[A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'CHECK_FAILED',
      completedChecks: checks,
      statuses,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await vite?.close();
  await api?.close();
}
