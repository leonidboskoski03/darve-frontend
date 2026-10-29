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
    task: 'f04-03',
    collection: true,
    review: true,
    terms: true,
  });
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  vite = await createServer({
    mode: 'acceptance-review',
    envDir: false,
    clearScreen: false,
    server: { host: '127.0.0.1', port: 4175, strictPort: true, hmr: false },
  });
  await vite.listen();
  browser = await chromium.launch();
  const creator = await api.seedSession({ expiresInMs: 600000 });
  const initialStream = await api.collectionFixture.seed(creator.userId);
  api.collectionFixture.capacity('available');
  const context = await browser.newContext();
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
  await page.goto(origin + '/collection');
  await page.getByRole('checkbox', { name: /I have read and accept account terms/ }).check();
  await page.getByRole('button', { name: 'Accept and continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start collection', exact: true })).toBeVisible();
  const session = await (
    await context.request.get(api.apiOrigin + '/api/session', { headers: { Origin: origin } })
  ).json();
  const headers = { Origin: origin, 'X-CSRF-Token': session.csrfToken };
  async function publishRound(stream = initialStream) {
    await page.goto(origin + '/collection');
    await page
      .getByRole('combobox', { name: /Connected account/ })
      .selectOption(stream.connectionId);
    await expect(page.getByRole('button', { name: 'Start collection', exact: true })).toBeEnabled();
    await page.getByLabel('Collection duration').fill('60');
    await page.getByRole('button', { name: 'Start collection', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Preparing your collection', exact: true }),
    ).toBeVisible();
    await api.collectionFixture.recover();
    await expect(
      page.getByRole('heading', { name: 'Collecting viewer ideas', exact: true }),
    ).toBeVisible();
    const roundId = new URL(page.url()).pathname.split('/').at(-1);
    await api.collectionFixture.admitIdeas(creator.userId, roundId);
    await page.getByRole('button', { name: 'Stop collection', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm stop', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Collection ended', exact: true }),
    ).toBeVisible();
    await api.reviewFixture.publish(creator.userId, roundId);
    await page.getByRole('link', { name: 'Review viewer ideas', exact: true }).click();
    await expect(page.getByRole('article')).toHaveCount(2);
    return roundId;
  }
  const roundId = await publishRound();
  checks.push(
    'actual ingestion admission, freeze, controlled-model processing and safe review publication',
  );
  let wire = await (
    await context.request.get(`${api.apiOrigin}/api/rounds/${roundId}/suggestions`, { headers })
  ).json();
  const item = wire.data.items[0];
  assert.equal(wire.data.totalSafeCount, 2);
  assert.equal(
    wire.data.items.reduce((sum, value) => sum + value.sourceSubmissionIds.length, 0),
    3,
  );
  const grouped = wire.data.items.find((value) => value.authors.length === 2);
  assert.ok(grouped);
  assert.equal(grouped.authors[0].displayName, grouped.authors[1].displayName);
  assert.notEqual(grouped.authors[0].providerAuthorId, grouped.authors[1].providerAuthorId);
  checks.push('actual grouped publication preserves every source and duplicate-name author credit');
  const button = page.getByRole('button', { name: 'Pin idea 1', exact: true });
  await button.click();
  await expect(page.getByRole('button', { name: 'Unpin idea 1', exact: true })).toBeEnabled();
  wire = await (
    await context.request.get(`${api.apiOrigin}/api/rounds/${roundId}/suggestions`, { headers })
  ).json();
  assert.equal(wire.data.items[0].pinned, true);
  assert.equal(wire.data.items[0].version, 2);
  checks.push('actual version-confirmed disposition persists in PostgreSQL');
  const current = wire.data.items[0],
    body = {
      expectedVersion: current.version,
      analysisRunId: current.analysisRunId,
      resultVersion: wire.data.resultVersion,
      snapshotVersion: current.snapshotVersion,
      goal: { amountMinor: '2550', currency: 'EUR' },
      fundingDurationSeconds: 600,
    };
  const endpoint = `${api.apiOrigin}/api/rounds/${roundId}/suggestions/${item.id}/accept`;
  const bad = await context.request.post(endpoint, {
    headers: { ...headers, 'X-CSRF-Token': 'wrong', 'Idempotency-Key': randomUUID() },
    data: body,
  });
  assert.equal(bad.status(), 403);
  assert.deepEqual(await api.reviewFixture.counts(creator.userId), { challenges: 0, receipts: 0 });
  checks.push('actual incorrect-CSRF acceptance creates no challenge or receipt');
  const stale = await context.request.post(endpoint, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: { ...body, expectedVersion: 1 },
  });
  assert.equal(stale.status(), 409);
  checks.push('actual stale suggestion version cannot create a financial commitment');
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
  assert.equal(
    (
      await foreign.request.get(`${api.apiOrigin}/api/rounds/${roundId}/suggestions`, {
        headers: { Origin: origin },
      })
    ).status(),
    404,
  );
  await foreign.close();
  checks.push('actual other creator cannot read published suggestions');
  let sent = null;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/accept') && request.method() === 'POST')
      sent = { body: request.postDataJSON(), key: request.headers()['idempotency-key'] };
  });
  async function acceptIdea() {
    await page.getByRole('button', { name: 'Accept idea 1', exact: true }).click();
    await page.getByLabel('Funding goal', { exact: true }).fill('25.50');
    await page.getByLabel('Funding duration in seconds', { exact: true }).fill('600');
    await page.getByRole('button', { name: 'Review exact terms', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm acceptance', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Accepted challenge', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Awaiting funding', { exact: true })).toBeVisible();
  }
  await acceptIdea();
  assert.ok(sent);
  assert.equal(sent.body.goal.amountMinor, '2550');
  assert.deepEqual(await api.reviewFixture.counts(creator.userId), { challenges: 1, receipts: 1 });
  checks.push(
    'actual confirmed acceptance persists exact terms and reads the owned challenge projection',
  );
  const replay = await context.request.post(endpoint, {
    headers: { ...headers, 'Idempotency-Key': sent.key },
    data: sent.body,
  });
  assert.equal(replay.status(), 200);
  assert.deepEqual(await api.reviewFixture.counts(creator.userId), { challenges: 1, receipts: 1 });
  const conflict = await context.request.post(endpoint, {
    headers: { ...headers, 'Idempotency-Key': sent.key },
    data: { ...sent.body, goal: { amountMinor: '2600', currency: 'EUR' } },
  });
  assert.equal(conflict.status(), 409);
  checks.push('actual same-key replay is one operation and changed terms conflict');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'View accepted challenge', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept idea 2', exact: true })).toBeDisabled();
  await expect(page.getByRole('article')).toHaveCount(2);
  checks.push('actual full reload retains acceptance and other ideas without auto-rejection');
  const nextStream = await api.collectionFixture.seed(creator.userId);
  const nextRound = await publishRound(nextStream);
  api.collectionFixture.funding('not_ready');
  await acceptDenied();
  checks.push('actual receiving-readiness denial is visible without a created challenge');
  async function acceptDenied() {
    await page.getByRole('button', { name: 'Accept idea 1', exact: true }).click();
    await page.getByLabel('Funding goal', { exact: true }).fill('25.50');
    await page.getByLabel('Funding duration in seconds', { exact: true }).fill('600');
    await page.getByRole('button', { name: 'Review exact terms', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm acceptance', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('A ready receiving account is required');
    await page.getByRole('button', { name: 'Back to review', exact: true }).click();
    assert.deepEqual(await api.reviewFixture.counts(creator.userId), {
      challenges: 1,
      receipts: 1,
    });
  }
  api.collectionFixture.funding('ready');
  await acceptIdea();
  assert.deepEqual(await api.reviewFixture.counts(creator.userId), { challenges: 2, receipts: 2 });
  checks.push('actual acceptance in a later round coexists with the earlier funding challenge');
  await api.reviewFixture.restrict(nextRound);
  await page.getByRole('button', { name: 'Refresh results', exact: true }).click();
  await expect(page.getByText('These source ideas are restricted.', { exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Accepted challenge', exact: true })).toHaveCount(
    0,
  );
  checks.push('actual source restriction removes suggestion and cached challenge content');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Connect your stream to Darve', exact: true }),
  ).toBeVisible();
  assert.equal(await api.revoked(creator.sessionId), true);
  checks.push('actual logout revokes the session and removes review authority');
  assert.deepEqual(errors, []);
  const result = {
    source: api.source,
    migrations: api.migrations,
    checks,
    pageErrors: errors,
    realPostgres: true,
    realRedis: true,
    actualIngestionAdmission: true,
    actualAnalysisProcessing: true,
    controlledModelAndProviderFacts: true,
    syntheticCommercialPolicy: true,
    externalProviderCalls: false,
    liveCollectionOrAnalysisVerified: false,
  };
  mkdirSync('artifacts.local/f04-03', { recursive: true });
  writeFileSync('artifacts.local/f04-03/acceptance.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await vite?.close();
  await api?.close();
}
