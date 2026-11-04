import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build, preview } from 'vite';
import { chromium } from '@playwright/test';
import { startLocalApi } from './local-api.mjs';

const evidence = resolve('artifacts.local/f09-02');
mkdirSync(evidence, { recursive: true });
const origin = 'http://127.0.0.1:4175';
const checks = [],
  requests = [],
  errors = [];
let api,
  site,
  browser,
  phase = 'setup',
  failure;
try {
  api = await startLocalApi({
    backend: process.argv[2] ?? '../tmp/backend-f06-checkout',
    task: 'f09-02',
    coins: true,
    origins: [origin],
    port: 3310,
  });
  const fixture = api.coinFixture;
  assert(fixture);
  await assert.rejects(api.seedSession({ coinOwner: true }), /Existing coin owner requires/);
  await build({ configFile: 'vite.acceptance.config.ts', logLevel: 'error' });
  site = await preview({ configFile: 'vite.acceptance.config.ts', logLevel: 'error' });
  browser = await chromium.launch();
  const context = await browser.newContext();
  const creator = await api.seedSession({ expiresInMs: 180_000 });
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
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === api.apiOrigin)
      requests.push({ method: request.method(), path: url.pathname });
  });
  await page.goto(origin + '/tests/fixtures/coins.html');
  await page.waitForFunction(() => Boolean(globalThis.coinProbe));
  assert.equal(await page.evaluate(() => globalThis.coinProbe.start()), 'authenticated');
  const read = (kind, query = {}) =>
    page.evaluate(({ kind, query }) => globalThis.coinProbe.read(kind, query), { kind, query });
  phase = 'unavailable';
  await fixture.unavailable(true);
  assert.deepEqual(await read('account'), { ok: false, code: 'SERVICE_UNAVAILABLE', status: 503 });
  await fixture.unavailable(false);
  checks.push(
    'actual restricted API refuses unavailable program binding without returning a zero balance',
  );
  phase = 'unconfigured';
  const account = await read('account');
  assert.equal(account.ok, true);
  assert.equal(account.value.data.state, 'unconfigured');
  // Unconfigured can still report an exact zero. State/permission remain authoritative.
  assert.equal(account.value.data.spendableBalance, '0');
  assert.equal(account.value.data.redemptionAllowed, true);
  const missions = await read('missions');
  assert.equal(missions.ok, true);
  assert.equal(missions.value.data.missions.length, 6);
  assert(missions.value.data.missions.every((m) => m.currentReward === null && !m.completed));
  for (const kind of ['ledger', 'catalogue', 'entitlements', 'selection'])
    assert.equal((await read(kind)).ok, true);
  checks.push(
    'all six production-compiled creator read adapters validate actual unconfigured API responses',
  );
  phase = 'query boundary';
  const invalid = await page.evaluate(
    async (origin) =>
      (await fetch(origin + '/api/coins/ledger?limit=100', { credentials: 'include' })).status,
    api.apiOrigin,
  );
  assert.equal(invalid, 400);
  checks.push('actual history endpoint rejects unsupported caller pagination parameters');
  phase = 'ready';
  await fixture.configure();
  const configured = await read('account');
  assert.equal(configured.ok, true);
  assert.equal(configured.value.data.state, 'synchronized');
  assert.equal(configured.value.data.balance, '0');
  assert.equal(configured.value.data.spendableBalance, '0');
  const configuredMissions = await read('missions');
  assert.equal(configuredMissions.ok, true);
  assert(
    configuredMissions.value.data.missions.every(
      (m) => typeof m.currentReward === 'string' && !m.completed && m.earned === null,
    ),
  );
  checks.push(
    'real owner service configures synthetic rewards; creator reads preserve state and permissions independently of exact zero',
  );
  phase = 'isolation';
  const peerContext = await browser.newContext();
  const peer = await peerContext.newPage();
  await peer.goto(origin + '/tests/fixtures/coins.html');
  await peer.waitForFunction(() => Boolean(globalThis.coinProbe));
  assert.equal(await peer.evaluate(() => globalThis.coinProbe.start()), 'signed_out');
  assert.equal((await peer.evaluate(() => globalThis.coinProbe.read('account'))).ok, false);
  const denied = await peer.evaluate(
    async (origin) =>
      (await fetch(origin + '/api/coins/account', { credentials: 'include' })).status,
    api.apiOrigin,
  );
  assert.equal(denied, 401);
  await peerContext.close();
  checks.push(
    'fresh browser has no creator authority; both adapter and actual API deny private reads',
  );
  phase = 'revocation';
  await page.evaluate(() => globalThis.coinProbe.logout());
  assert.equal(await api.revoked(creator.sessionId), true);
  assert.equal((await read('account')).ok, false);
  await context.addCookies([
    {
      name: 'darve_session',
      value: creator.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  assert.equal(
    await page.evaluate(
      async (origin) =>
        (await fetch(origin + '/api/coins/account', { credentials: 'include' })).status,
      api.apiOrigin,
    ),
    401,
  );
  checks.push(
    'actual logout revokes SQL session and old adapter/cookie cannot recover coin information',
  );
  phase = 'custody';
  const facts = await fixture.facts();
  assert.equal(facts.configurations, 1);
  assert.equal(facts.ledger, 0);
  assert.equal(facts.entitlements, 0);
  assert.equal(facts.journalRecords, 0);
  assert.equal(
    requests.filter((r) => r.method !== 'GET' && r.path !== '/api/session/logout').length,
    0,
  );
  assert.deepEqual(errors, []);
  checks.push(
    'no browser business mutations, ledger entries or purchased entitlements; worker SQL authority and actual journal readiness recorded separately',
  );
  writeFileSync(
    resolve(evidence, 'acceptance.json'),
    JSON.stringify(
      {
        head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        backendPin: api.source,
        migrations: api.migrations,
        checks,
        fixtureFacts: facts,
        custody: fixture.custody,
        controlledReadiness: true,
        synthetic: true,
        productionCompiled: true,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  const detail = String(error.message)
    .replace(/(?:postgres(?:ql)?|redis):\/\/[^\s]+/g, '[private storage]')
    .replace(/[A-Za-z0-9_+/=-]{32,}/g, '[redacted]');
  failure = { phase, name: error.name, detail, location: error.stack?.split('\n').slice(1, 7) };
  writeFileSync(resolve(evidence, 'failure.json'), JSON.stringify({ failure, checks }, null, 2));
  console.error('F09 read acceptance failed during ' + phase + ' (' + error.name + '): ' + detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (site)
    await new Promise((done) => {
      site.httpServer.close(done);
      site.httpServer.closeAllConnections();
    });
  await api?.close();
}
if (!failure) {
  const result = JSON.parse(readFileSync(resolve(evidence, 'acceptance.json'), 'utf8'));
  writeFileSync(
    resolve(evidence, 'acceptance.json'),
    JSON.stringify({ ...result, cleanupComplete: true }, null, 2),
  );
  console.log(
    'Passed ' +
      checks.length +
      ' actual F09 browser/API/SQL read checks; labelled storage, journal and listeners cleaned.',
  );
}
