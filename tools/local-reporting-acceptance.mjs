import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { startLocalApi } from './local-api.mjs';
const origin = 'http://127.0.0.1:4175',
  checks = [],
  errors = [];
let api, vite, browser;
try {
  api = await startLocalApi({
    backend: process.argv[2] ?? '../darve-backend',
    origins: [origin],
    task: 'f05',
    collection: true,
    review: true,
    reporting: true,
    terms: true,
  });
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  vite = await createServer({
    mode: 'acceptance-reporting',
    envDir: false,
    clearScreen: false,
    server: { host: '127.0.0.1', port: 4175, strictPort: true, hmr: false },
  });
  await vite.listen();
  browser = await chromium.launch();
  const creator = await api.seedSession({ expiresInMs: 600000 }),
    context = await browser.newContext();
  await context.addCookies([
    {
      name: 'darve_session',
      value: creator.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.name));
  await page.goto(origin + '/dashboard');
  await page.getByRole('checkbox', { name: /I have read and accept account terms/ }).check();
  await page.getByRole('button', { name: 'Accept and continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  const session = await (
      await context.request.get(api.apiOrigin + '/api/session', { headers: { Origin: origin } })
    ).json(),
    headers = { Origin: origin, 'X-CSRF-Token': session.csrfToken };
  const get = async (path) => {
    const response = await context.request.get(api.apiOrigin + path, { headers });
    assert.equal(response.status(), 200);
    return (await response.json()).data;
  };
  const empty = await get('/api/dashboard/summary?timeZone=UTC');
  assert.equal(empty.history.acceptedChallenges, 0);
  assert.deepEqual(empty.history.contributionsByCurrency, []);
  checks.push('actual creator/current-terms dashboard has honest empty retained records');
  await page.getByLabel('Reporting timezone', { exact: true }).fill('Europe/Warsaw');
  await page.getByLabel('From date', { exact: true }).fill('2026-03-29');
  await page.getByLabel('Through date', { exact: true }).fill('2026-03-29');
  await page.getByRole('button', { name: 'Apply reporting filters', exact: true }).click();
  await expect(page).toHaveURL(/timeZone=Europe%2FWarsaw/);
  await expect(page.getByText('Server interval:', { exact: false })).toContainText(
    '2026-03-28T23:00:00.000Z inclusive to 2026-03-29T22:00:00.000Z exclusive',
  );
  checks.push(
    'actual encoded IANA timezone and civil-day report retain the 23-hour daylight-saving interval',
  );
  api.collectionFixture.capacity('available');
  async function accepted(currency = 'EUR', amountMinor = '1000', seconds = 600) {
    const stream = await api.collectionFixture.seed(creator.userId);
    const start = await context.request.post(api.apiOrigin + '/api/rounds', {
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
    assert.equal(active.state, 'collecting');
    await api.collectionFixture.admitIdeas(creator.userId, roundId);
    const stop = await context.request.post(
      `${api.apiOrigin}/api/rounds/${roundId}/collection/stop`,
      { headers, data: { expectedVersion: active.version } },
    );
    assert.equal(stop.status(), 202);
    await api.reviewFixture.publish(creator.userId, roundId);
    const suggestions = await get(`/api/rounds/${roundId}/suggestions`),
      item = suggestions.items[0];
    const response = await context.request.post(
      `${api.apiOrigin}/api/rounds/${roundId}/suggestions/${item.id}/accept`,
      {
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {
          expectedVersion: item.version,
          analysisRunId: item.analysisRunId,
          resultVersion: suggestions.resultVersion,
          snapshotVersion: item.snapshotVersion,
          goal: { amountMinor, currency },
          fundingDurationSeconds: seconds,
        },
      },
    );
    assert.equal(response.status(), 201);
    return { challenge: (await response.json()).data, roundId, ...stream };
  }
  const first = await accepted(),
    id = first.challenge.id,
    endpoint = `${api.apiOrigin}/api/challenges/${id}/completion-declarations`;
  let detail = await get('/api/challenges/' + id);
  const body = {
    expectedVersion: detail.performance.revision,
    termsVersion: detail.terms.version,
    ...(detail.performanceAuthority
      ? { expectedPerformanceRevision: detail.performanceAuthority.revision }
      : {}),
  };
  const unfunded = await context.request.post(endpoint, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: body,
  });
  assert.equal(unfunded.status(), 409);
  assert.equal((await unfunded.json()).error.code, 'NOT_FUNDED');
  assert.equal(await api.reportingFixture.declarationCount(creator.userId), 0);
  checks.push('actual unfunded declaration is denied without a persisted statement');
  await api.reportingFixture.fund(id);
  detail = await get('/api/challenges/' + id);
  assert.equal(detail.funding.state, 'funded');
  assert.equal(detail.performance.state, 'awaiting_performance');
  await page.goto(origin + '/challenges/' + id);
  await expect(page.getByRole('button', { name: 'Declare completion', exact: true })).toBeVisible();
  assert.equal(await api.reportingFixture.declarationCount(creator.userId), 0);
  checks.push(
    'actual controlled verified-payment evidence recognizes funding without declaring performance',
  );
  const csrf = await context.request.post(endpoint, {
    headers: { ...headers, 'X-CSRF-Token': 'wrong', 'Idempotency-Key': randomUUID() },
    data: body,
  });
  assert.equal(csrf.status(), 403);
  assert.equal(await api.reportingFixture.declarationCount(creator.userId), 0);
  checks.push('actual wrong-CSRF completion is denied before persistence');
  api.collectionFixture.streamChanged(true);
  const changed = await context.request.post(endpoint, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: body,
  });
  assert.equal(changed.status(), 409);
  assert.equal((await changed.json()).error.code, 'CONTEXT_CHANGED');
  api.collectionFixture.streamChanged(false);
  checks.push('actual changed original-stream observation cannot declare another broadcast');
  let sent = null;
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.endsWith('/completion-declarations') &&
      request.method() === 'POST'
    )
      sent = { key: request.headers()['idempotency-key'], body: request.postDataJSON() };
  });
  await page.getByRole('button', { name: 'Declare completion', exact: true }).click();
  const consent = page.getByRole('checkbox', {
    name: 'I confirm I completed this challenge on its original or authorized stream.',
    exact: true,
  });
  await expect(consent).not.toBeChecked();
  await consent.check();
  await page.getByRole('button', { name: 'Confirm completion declaration', exact: true }).click();
  await expect(
    page.getByText('Your completion declaration was recorded', { exact: false }),
  ).toBeVisible();
  assert.ok(sent);
  assert.equal(sent.body.expectedVersion, 1);
  detail = await get('/api/challenges/' + id);
  assert.equal(detail.performance.state, 'declared_complete');
  assert.equal(detail.performance.verification, 'streamer_declaration');
  assert.equal(await api.reportingFixture.declarationCount(creator.userId), 1);
  checks.push(
    'actual confirmed declaration persists immutable terms/authority and reconciles owned detail',
  );
  const replay = await context.request.post(endpoint, {
    headers: { ...headers, 'Idempotency-Key': sent.key },
    data: sent.body,
  });
  assert.equal(replay.status(), 200);
  const conflict = await context.request.post(endpoint, {
    headers: { ...headers, 'Idempotency-Key': sent.key },
    data: { ...sent.body, termsVersion: randomUUID() },
  });
  assert.equal(conflict.status(), 409);
  assert.equal(await api.reportingFixture.declarationCount(creator.userId), 1);
  checks.push('actual same-key declaration replay remains one record and changed terms conflict');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Declare completion', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText('Streamer declared complete', { exact: true })).toBeVisible();
  checks.push('actual full reload retains the canonical completion declaration');
  const second = await accepted('USD', '1007');
  await api.reportingFixture.fund(second.challenge.id);
  const third = await accepted('EUR', '1000', 1);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const summary = await get('/api/dashboard/summary?timeZone=UTC');
  assert.equal(summary.history.acceptedChallenges, 3);
  assert.equal(summary.history.historicallyFundedChallenges, 2);
  assert.equal(summary.history.streamerDeclaredCompletions, 1);
  assert.deepEqual(
    summary.history.contributionsByCurrency.map((row) => [row.currency, row.grossContributions]),
    [
      ['EUR', '1000'],
      ['USD', '1007'],
    ],
  );
  checks.push(
    'actual dashboard retains overlapping challenges and exact separate EUR/USD verified gross rows',
  );
  const history = await get('/api/challenges?limit=1');
  assert.equal(history.items.length, 1);
  assert.ok(history.nextCursor);
  const rest = await get(
    '/api/challenges?limit=50&cursor=' + encodeURIComponent(history.nextCursor),
  );
  assert.equal(rest.items.length, 2);
  assert.equal(new Set([history.items[0].id, ...rest.items.map((value) => value.id)]).size, 3);
  const current = await get('/api/challenges/current');
  assert.equal(current.items.length, 2);
  assert.ok(!current.items.some((value) => value.id === third.challenge.id));
  checks.push(
    'actual owner cursor history preserves expired funding while current means open effective windows',
  );
  await page.goto(origin + '/challenges');
  await expect(page.getByRole('article')).toHaveCount(3);
  await page.getByRole('button', { name: 'Open funding windows', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  checks.push(
    'actual history UI preserves multiple records and its explicit server funding-window scope',
  );
  const analytics = await get(`/api/rounds/${first.roundId}/analytics`);
  assert.equal(analytics.roundId, first.roundId);
  assert.equal(analytics.eligibleSubmissions.value, 3);
  assert.equal(analytics.financial.challengeId, id);
  assert.equal(analytics.financial.scope, 'accepted_challenge_lifetime');
  await page.goto(origin + `/collection/${first.roundId}/analytics`);
  await expect(page.getByRole('heading', { name: 'Round analytics', exact: true })).toBeVisible();
  checks.push(
    'actual known-round analytics binds admitted counts and accepted-challenge lifetime finances',
  );
  const foreign = await browser.newContext(),
    other = await api.seedSession();
  await foreign.addCookies([
    {
      name: 'darve_session',
      value: other.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  for (const path of [
    '/api/challenges/' + id,
    `/api/rounds/${first.roundId}/analytics`,
    '/api/dashboard/summary?timeZone=UTC&broadcastId=' + first.broadcastId,
  ])
    assert.equal(
      (await foreign.request.get(api.apiOrigin + path, { headers: { Origin: origin } })).status(),
      404,
    );
  assert.equal(
    (
      await foreign.request.get(
        api.apiOrigin + '/api/challenges?cursor=' + encodeURIComponent(history.nextCursor),
        { headers: { Origin: origin } },
      )
    ).status(),
    400,
  );
  await foreign.close();
  checks.push(
    'actual foreign detail/analytics/broadcast selection and owner cursor cannot leak another creator records',
  );
  await api.reviewFixture.restrict(first.roundId);
  await page.goto(origin + '/challenges/' + id);
  await expect(
    page.getByRole('heading', { name: 'Challenge content unavailable', exact: true }),
  ).toBeVisible();
  assert.equal(await api.reportingFixture.declarationCount(creator.userId), 1);
  checks.push(
    'actual source restriction hides content while preserving historical declaration custody',
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Connect your stream to Darve', exact: true }),
  ).toBeVisible();
  assert.equal(await api.revoked(creator.sessionId), true);
  checks.push('actual logout revokes the reporting session and removes private controls');
  assert.deepEqual(errors, []);
  const result = {
    source: api.source,
    migrations: api.migrations,
    checks,
    pageErrors: errors,
    realPostgres: true,
    realRedis: true,
    actualFinancialRepositories: true,
    controlledProviderModelReceivingAndFinancialEvidence: true,
    externalProviderOrPaymentCalls: false,
    livePaymentsOrStreamVerification: false,
  };
  mkdirSync('artifacts.local/f05', { recursive: true });
  writeFileSync('artifacts.local/f05/acceptance.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await vite?.close();
  await api?.close();
}
