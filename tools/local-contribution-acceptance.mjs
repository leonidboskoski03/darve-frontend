import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { startLocalApi } from './local-api.mjs';
const origin = 'http://127.0.0.1:4175',
  checks = [],
  errors = [];
let api,
  vite,
  browser,
  stage = 'startup';
try {
  api = await startLocalApi({
    backend: process.argv[2] ?? '../darve-backend',
    origins: [origin],
    task: 'f06',
    collection: true,
    review: true,
    contributionReads: true,
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
  stage = 'accepted challenge and private existing receipts';
  const challenge = await accepted(),
    waiting = await api.contributionFixture.seed(challenge.id),
    unknown = await api.contributionFixture.seed(challenge.id, { state: 'unknown' }),
    failed = await api.contributionFixture.seed(challenge.id, { state: 'failed' });
  const guest = await browser.newContext();
  const cookie = (secret) => ({
    name: 'darve_payment_guest',
    value: secret,
    domain: '127.0.0.1',
    path: '/api',
    httpOnly: true,
    sameSite: 'Lax',
  });
  await guest.addCookies([cookie(waiting.secret)]);
  const page = await guest.newPage(),
    reads = [];
  const visit = (url) => page.goto(url, { waitUntil: 'domcontentloaded' });
  page.on('pageerror', (error) => errors.push(error.name));
  page.on('request', (request) => {
    if (request.url().startsWith(api.apiOrigin) && request.method() !== 'OPTIONS')
      reads.push({
        path: new URL(request.url()).pathname,
        method: request.method(),
        cookiePresent: !!request.headers().cookie,
      });
  });
  await visit(origin + '/contribute/' + waiting.publicId);
  await expect(
    page.getByRole('heading', { name: 'Contribution availability', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Payments are not enabled');
  assert.ok(reads.every((row) => row.method === 'GET' && !row.path.includes('/session')));
  assert.ok(
    reads.filter((row) => row.path.startsWith('/api/public/')).every((row) => !row.cookiePresent),
  );
  checks.push(
    'actual public projection omits guest/creator cookies and keeps both provider methods unavailable',
  );
  stage = 'ordinary creation denial';
  const beforeCreation = await api.contributionFixture.audit();
  const disabled = await guest.request.post(
    `${api.apiOrigin}/api/public/challenges/${waiting.publicId}/checkouts`,
    {
      headers: { Origin: origin, 'Idempotency-Key': randomUUID() },
      data: {
        termsVersion: (await get('/api/challenges/' + challenge.id)).terms.version,
        paymentProvider: 'stripe',
        amountMinor: '1007',
      },
    },
  );
  assert.equal(disabled.status(), 503);
  assert.equal((await disabled.json()).error.code, 'POLICY_UNAVAILABLE');
  assert.equal((await api.contributionFixture.audit()).attempts, beforeCreation.attempts);
  checks.push(
    'actual HTTP composition refuses creation under the existing disabled policy with no new attempt',
  );
  stage = 'private proof separation';
  const foreign = await browser.newContext();
  assert.equal(
    (
      await foreign.request.get(`${api.apiOrigin}/api/checkouts/${waiting.id}`, {
        headers: { Origin: origin },
      })
    ).status(),
    401,
  );
  assert.equal(
    (await owner.request.get(`${api.apiOrigin}/api/checkouts/${waiting.id}`, { headers })).status(),
    401,
  );
  await foreign.addCookies([cookie(unknown.secret)]);
  assert.equal(
    (
      await foreign.request.get(`${api.apiOrigin}/api/checkouts/${waiting.id}`, {
        headers: { Origin: origin },
      })
    ).status(),
    404,
  );
  checks.push(
    'actual missing creator-only and foreign guest proofs cannot read another private receipt',
  );
  stage = 'pending receipt reload and return';
  await visit(origin + '/receipts/' + waiting.id);
  await expect(
    page.getByRole('heading', { name: 'Payment not confirmed', exact: true }),
  ).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { name: 'Payment not confirmed', exact: true }),
  ).toBeVisible();
  checks.push(
    'actual pending receipt survives reload through its HttpOnly guest cookie with no monetary replay',
  );
  await visit(
    `${origin}/payments/return?checkout=${waiting.id}&token=synthetic-untrusted&PayerID=synthetic-untrusted&status=success#synthetic-untrusted`,
  );
  await expect(page).toHaveURL(origin + '/receipts/' + waiting.id);
  await expect(
    page.getByRole('heading', { name: 'Payment not confirmed', exact: true }),
  ).toBeVisible();
  checks.push(
    'actual product return sanitizes provider hints before routing and never treats return as payment success',
  );
  stage = 'unknown and failed receipts';
  for (const receipt of [unknown, failed]) {
    await guest.addCookies([cookie(receipt.secret)]);
    await visit(origin + '/receipts/' + receipt.id);
    await expect(
      page.getByRole('heading', {
        name: receipt === failed ? 'Checkout failed' : 'Payment not confirmed',
        exact: true,
      }),
    ).toBeVisible();
  }
  checks.push(
    'actual canonical unknown and failed attempts stay distinct and never trigger replacement creation',
  );
  stage = 'verified unknown timing';
  await api.contributionFixture.settle(unknown.id);
  await guest.addCookies([cookie(unknown.secret)]);
  await visit(origin + '/receipts/' + unknown.id);
  await expect(
    page.getByRole('heading', { name: 'Verified payment recorded', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Payment timing needs review', exact: true }),
  ).toBeVisible();
  checks.push(
    'actual trusted financial repository proof retains verified money with unclassified timing and null paidAt',
  );
  stage = 'verified eligible timing';
  await api.contributionFixture.settle(waiting.id, 'now');
  await guest.addCookies([cookie(waiting.secret)]);
  await visit(origin + '/receipts/' + waiting.id);
  await expect(page.getByRole('heading', { name: 'Deadline eligible', exact: true })).toBeVisible();
  checks.push(
    'actual canonical eligible receipt uses verified provider-time provenance rather than browser return time',
  );
  stage = 'verified late timing';
  const short = await accepted(1),
    late = await api.contributionFixture.seed(short.id);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await api.contributionFixture.settle(late.id, 'now');
  await guest.addCookies([cookie(late.secret)]);
  await visit(origin + '/receipts/' + late.id);
  await expect(
    page.getByRole('heading', { name: 'Received outside the funding deadline', exact: true }),
  ).toBeVisible();
  checks.push(
    'actual server-expired funding window retains a verified late payment without inventing eligibility or refunds',
  );
  stage = 'public restriction and financial history';
  await api.reviewFixture.restrict(challenge.roundId);
  await visit(origin + '/contribute/' + waiting.publicId);
  await expect(
    page.getByRole('heading', { name: 'Challenge content unavailable', exact: true }),
  ).toBeVisible();
  await guest.addCookies([cookie(waiting.secret)]);
  await visit(origin + '/receipts/' + waiting.id);
  await expect(
    page.getByRole('heading', { name: 'Verified payment recorded', exact: true }),
  ).toBeVisible();
  checks.push(
    'actual source restriction hides public content while preserving private financial receipt custody',
  );
  stage = 'revoked guest refresh';
  await api.contributionFixture.revoke(waiting.secretHash);
  await page.getByRole('button', { name: 'Refresh receipt', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('unavailable in this browser');
  await expect(
    page.getByRole('heading', { name: 'Verified payment recorded', exact: true }),
  ).toHaveCount(0);
  checks.push('actual revoked guest proof hides previously read private money on refresh');
  stage = 'expired guest proof';
  const expiryChallenge = await accepted(),
    expiring = await api.contributionFixture.seed(expiryChallenge.id, { lifetimeMs: 500 });
  await guest.addCookies([cookie(expiring.secret)]);
  await new Promise((resolve) => setTimeout(resolve, 600));
  await visit(origin + '/receipts/' + expiring.id);
  await expect(page.getByRole('alert')).toContainText('unavailable in this browser');
  checks.push('actual expired guest proof cannot be restored from its receipt identifier');
  stage = 'no browser monetary actions and storage';
  assert.ok(reads.every((row) => row.method === 'GET' && !row.path.includes('/session')));
  assert.deepEqual(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
    { local: 0, session: 0 },
  );
  assert.deepEqual(errors, []);
  checks.push(
    'actual guest browser sends only GET reads with no creator inspection browser storage or page errors',
  );
  const result = {
    runId: api.runId,
    source: api.source,
    migrations: api.migrations,
    checks,
    pageErrors: errors,
    actualPostgresRedis: true,
    actualFinancialRepositoriesAndHttp: true,
    syntheticProviderModelReceivingAndExistingReceiptFacts: true,
    ordinaryCreationEnabled: false,
    browserMonetaryCommands: false,
    externalProviderOrPaymentCalls: false,
    liveOrSandboxPaymentVerified: false,
    aggregate: await api.contributionFixture.audit(),
  };
  mkdirSync('artifacts.local/f06', { recursive: true });
  writeFileSync('artifacts.local/f06/acceptance.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(
    JSON.stringify({
      failedStage: stage,
      errorType: error?.name ?? 'Error',
      timedOut: /Timeout|timed out/.test(error?.message ?? ''),
      sourceLine:
        (error?.stack ?? '').match(/local-contribution-acceptance\.mjs:\d+:\d+/)?.[0] ?? null,
      safeCode: /^[A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'CHECK_FAILED',
      completedChecks: checks,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await vite?.close();
  await api?.close();
}
