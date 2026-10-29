import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { startLocalApi } from './local-api.mjs';
const origin = 'http://127.0.0.1:4175';
let api, vite, browser;
const checks = [],
  errors = [];
try {
  api = await startLocalApi({
    backend: process.argv[2] ?? '../darve-backend',
    origins: [origin],
    task: 'f04-02',
    collection: true,
    terms: true,
  });
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  vite = await createServer({
    mode: 'acceptance-collection',
    clearScreen: false,
    envDir: false,
    server: { host: '127.0.0.1', port: 4175, strictPort: true, hmr: false },
  });
  await vite.listen();
  browser = await chromium.launch();
  const creator = await api.seedSession({ expiresInMs: 300000 });
  const streams = {};
  for (const provider of ['TWITCH', 'YOUTUBE', 'KICK'])
    streams[provider] = await api.collectionFixture.seed(creator.userId, provider);
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
  checks.push('actual creator session and terms guard lead to the real workspace');
  // Actual Start/SQL reservation and 202 preparation for every provider, with controlled busy capacity.
  for (const [provider, label] of [
    ['TWITCH', 'Twitch'],
    ['YOUTUBE', 'YouTube'],
    ['KICK', 'Kick'],
  ]) {
    await page.getByRole('radio', { name: label, exact: true }).check();
    try {
      await expect(
        page.getByRole('button', { name: 'Start collection', exact: true }),
      ).toBeEnabled();
    } catch (error) {
      mkdirSync('artifacts.local/f04-02', { recursive: true });
      writeFileSync(
        'artifacts.local/f04-02/disabled-synthetic.txt',
        await page.locator('body').innerText(),
      );
      throw error;
    }
    await page.getByRole('button', { name: 'Start collection', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Preparing your collection', exact: true }),
    ).toBeVisible();
    const id = new URL(page.url()).pathname.split('/').at(-1);
    await api.collectionFixture.recover();
    assert.equal((await api.collectionFixture.roundState(id)).state, 'preparing');
    await page.reload();
    await expect(page.getByLabel('Remaining collection time')).toHaveText('Waiting');
    await page.getByRole('button', { name: 'Cancel preparation', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Collection cancelled', exact: true }),
    ).toBeVisible();
    assert.deepEqual((await api.collectionFixture.roundState(id)).snapshotCount, 0);
    checks.push(
      `actual ${provider} Start/preparation/reload/cancel persists without an active countdown or snapshot`,
    );
    await page.goto(origin + '/collection');
  }
  // A fresh synthetic source keeps the primed reader lease independent of cancelled demands.
  const activeCreator = await api.seedSession({ expiresInMs: 300000 });
  const activeStream = await api.collectionFixture.seed(activeCreator.userId, 'TWITCH');
  await context.addCookies([
    {
      name: 'darve_session',
      value: activeCreator.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(origin + '/collection');
  await page.getByRole('checkbox', { name: /I have read and accept account terms/ }).check();
  await page.getByRole('button', { name: 'Accept and continue', exact: true }).click();
  api.collectionFixture.capacity('available');
  await expect(page.getByRole('button', { name: 'Start collection', exact: true })).toBeEnabled();
  await page.getByLabel('Collection duration').fill('10');
  const session = await context.request.get(api.apiOrigin + '/api/session');
  const sessionValue = await session.json();
  const body = { ...activeStream, collectionDurationSeconds: 10, announcementPinMode: 'off' };
  const bad = await context.request.post(api.apiOrigin + '/api/rounds', {
    headers: {
      Origin: origin,
      'X-CSRF-Token': 'b'.repeat(43),
      'Idempotency-Key': crypto.randomUUID(),
    },
    data: body,
  });
  assert.equal(bad.status(), 403);
  checks.push('actual Start rejects incorrect CSRF before creating a round');
  await page.getByRole('button', { name: 'Start collection', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Preparing your collection', exact: true }),
  ).toBeVisible();
  await api.collectionFixture.recover();
  try {
    await expect(
      page.getByRole('heading', { name: 'Collecting viewer ideas', exact: true }),
    ).toBeVisible();
  } catch (error) {
    console.log(
      JSON.stringify({
        controlledFixtureDiagnostic: await api.collectionFixture.debugRound(
          activeCreator.userId,
          new URL(page.url()).pathname.split('/').at(-1),
        ),
      }),
    );
    throw error;
  }
  const roundId = new URL(page.url()).pathname.split('/').at(-1);
  assert.equal((await api.collectionFixture.roundState(roundId)).state, 'collecting');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Collecting viewer ideas', exact: true }),
  ).toBeVisible();
  checks.push(
    'actual controlled-reader Start activates and full reload retains the same server round',
  );
  await page.getByRole('button', { name: 'Stop collection', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm stop', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Collection ended', exact: true })).toBeVisible();
  const closed = await api.collectionFixture.roundState(roundId);
  assert.equal(closed.state, 'closed');
  assert.equal(closed.snapshotCount, 1);
  checks.push('actual Stop closes the durable round and freezes one empty snapshot');
  const foreign = await browser.newContext();
  const foreignActor = await api.seedSession();
  await foreign.addCookies([
    {
      name: 'darve_session',
      value: foreignActor.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const denied = await foreign.request.get(api.apiOrigin + '/api/rounds/' + roundId);
  assert.equal(denied.status(), 404);
  await foreign.close();
  checks.push('actual other creator cannot read the round');
  // Same reviewed operation key/body: actual SQL idempotency, no browser automatic replay.
  const operationKey = crypto.randomUUID();
  const post = () =>
    context.request.post(api.apiOrigin + '/api/rounds', {
      headers: {
        Origin: origin,
        'X-CSRF-Token': sessionValue.csrfToken,
        'Idempotency-Key': operationKey,
      },
      data: { ...body, collectionDurationSeconds: 1 },
    });
  api.collectionFixture.capacity('busy');
  const first = await post(),
    replay = await post();
  assert.equal(first.status(), 202);
  assert.equal(replay.status(), 202);
  assert.equal((await first.json()).data.id, (await replay.json()).data.id);
  assert.equal(await api.collectionFixture.roundCount(activeCreator.userId), 2);
  checks.push('actual same-key Start replay retains one operation identity');
  api.collectionFixture.funding('not_ready');
  await page.goto(origin + '/collection');
  await expect(page.getByRole('button', { name: 'Start collection', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Start collection', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('ready receiving account');
  checks.push('actual funding denial is visible and is not fabricated readiness');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Connect your stream to Darve', exact: true }),
  ).toBeVisible();
  assert.equal(await api.revoked(activeCreator.sessionId), true);
  assert.deepEqual(errors, []);
  checks.push('actual logout revokes authority and removes collection controls');
  mkdirSync('artifacts.local/f04-02', { recursive: true });
  const result = {
    source: api.source,
    migrations: api.migrations,
    checks,
    pageErrors: errors,
    realPostgres: true,
    realRedis: true,
    actualLifecycleRecovery: true,
    collectorProcessVerified: false,
    controlledProviderObservations: true,
    controlledFundingAndCapacity: true,
    externalProviderCalls: false,
    liveCollectionVerified: false,
  };
  writeFileSync('artifacts.local/f04-02/acceptance.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  const result = await Promise.allSettled([browser?.close(), vite?.close(), api?.close()]);
  if (result.some((value) => value.status === 'rejected')) {
    process.stderr.write('Collection acceptance cleanup failed; inspect owned metadata.\n');
    process.exitCode = 1;
  }
}
