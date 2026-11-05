import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { startConnectedProduct, portAvailable, connectedStatus } from './connected-product.mjs';
import {
  connectedStoragePorts,
  destroyAcceptanceStorage,
  inspectDevelopmentApi,
} from './connected-product-storage.mjs';
import { connectedOrigins as origins, frontendRoot } from './connected-product-config.mjs';

const backend = path.resolve(frontendRoot, '../tmp/backend-f06-checkout');
const directory = path.join(frontendRoot, 'artifacts.local/f02-04', randomUUID());
const options = {
  backend,
  directory,
  purpose: 'acceptance',
  pauseDevelopmentApi: true,
  credentialsFile: path.join(directory, 'no-provider.env'),
};
const stateFile = path.join(directory, 'private.json');
const initialDevelopmentApi = inspectDevelopmentApi();
const checks = [];
const pass = (name) => {
  checks.push(name);
  console.log('PASS ' + name);
};
const request = (pathname, options = {}) =>
  fetch(origins.api + pathname, {
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
    ...options,
  });
let app,
  browser,
  db,
  phase = 'startup';
try {
  app = await startConnectedProduct(options);
  assert.equal(app.migrations, 61);
  assert.equal((await request('/health/ready')).status, 200);
  assert.equal(connectedStatus(directory).restoreRequired, initialDevelopmentApi.State.Running);
  pass('current backend, isolated SQL/Redis and product readiness');
  phase = 'origin and private paths';
  const session = await request('/api/session', { headers: { Origin: origins.frontend } });
  assert.equal(session.status, 200);
  assert.equal(session.headers.get('access-control-allow-origin'), origins.frontend);
  assert.equal(session.headers.get('access-control-allow-credentials'), 'true');
  assert.equal((await session.json()).authenticated, false);
  for (const origin of ['http://127.0.0.1:5174', 'https://foreign.invalid']) {
    const denied = await request('/api/session', { headers: { Origin: origin } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  }
  for (const url of [
    '/artifacts.local/connected-product/private.json',
    '/%61rtifacts.local/connected-product/private.json',
    '/tools/connected-product.mjs',
    '/tests/fixtures/session.html',
    '/.env.local',
  ]) {
    assert.equal((await fetch(origins.frontend + url)).status, 404);
  }
  pass('exact credentialed Origin and private/fixture path denial');
  phase = 'signed out';
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.name));
  await page.goto(origins.frontend + '/dashboard');
  await expect(page.getByRole('heading', { name: 'Connect your stream to Darve' })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Continue with Twitch' }).click();
  await expect(page.getByRole('alert')).toContainText('not configured or is unavailable');
  pass('signed-out deep link and unconfigured identity feedback');
  phase = 'terms and workspace';
  const state = JSON.parse(readFileSync(stateFile, 'utf8')),
    ports = connectedStoragePorts(state);
  const load = (file) => import(pathToFileURL(path.join(backend, file)).href);
  const { createDatabase } = await load('packages/database/dist/index.js');
  const { sessionCsrfProof } = await load('apps/api/dist/security/proofs.js');
  db = createDatabase(
    'postgresql://frontend_local:' +
      state.postgresPassword +
      '@127.0.0.1:' +
      ports.postgres +
      '/darve_connected',
    5000,
  );
  // Synthetic session setup is acceptance-only. The normal product profile has no session-seeding path.
  const creator = await db.darveUser.create({
    data: { displayName: 'Synthetic connected-profile creator' },
  });
  await db.externalIdentity.create({
    data: {
      userId: creator.id,
      provider: 'TWITCH',
      issuer: 'https://synthetic.invalid',
      subject: randomUUID(),
    },
  });
  const secret = randomBytes(32).toString('base64url'),
    hash = (value) => createHash('sha256').update(value).digest('hex');
  const seeded = await db.darveSession.create({
    data: {
      userId: creator.id,
      secretHash: hash(secret),
      csrfHash: hash(sessionCsrfProof(secret)),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  await context.addCookies([
    { name: 'darve_session', value: secret, url: origins.api, httpOnly: true, sameSite: 'Lax' },
  ]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Read the current account terms' })).toBeVisible();
  const accept = page.getByRole('button', { name: 'Accept and continue' });
  await expect(accept).toBeDisabled();
  await page.getByRole('checkbox', { name: /I have read and accept/ }).check();
  await accept.click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByText('No retained activity in this reporting interval.')).toBeVisible();
  await page.goto(origins.frontend + '/collection');
  await expect(
    page.getByText('No account is connected on this platform.', { exact: false }),
  ).toBeVisible();
  assert.deepEqual(
    await page.evaluate(() => [globalThis.localStorage.length, globalThis.sessionStorage.length]),
    [0, 0],
  );
  const denied = await page.evaluate(
    async (base) =>
      (
        await fetch(base + '/api/session/logout', {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-CSRF-Token': 'z'.repeat(43) },
        })
      ).status,
    origins.api,
  );
  assert.equal(denied, 403);
  assert.equal(
    (await db.darveSession.findUniqueOrThrow({ where: { id: seeded.id } })).revokedAt,
    null,
  );
  pass('exact development terms, connected dashboard/collection and wrong-CSRF denial');
  phase = 'restart';
  await db.$disconnect();
  db = null;
  await app.close();
  assert.equal(
    inspectDevelopmentApi(initialDevelopmentApi.Id).State.Running,
    initialDevelopmentApi.State.Running,
  );
  assert.equal(await portAvailable(5174), true);
  app = await startConnectedProduct(options);
  const restarted = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(restarted.profileId, state.profileId);
  assert.deepEqual(restarted.resources, state.resources);
  assert.equal(restarted.cipherKey, state.cipherKey);
  await page.goto(origins.frontend + '/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByText('No retained activity in this reporting interval.')).toBeVisible();
  pass('restart preserves data, development terms, session and owned volume identity');
  phase = 'logout';
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect your stream to Darve' })).toBeVisible();
  const replay = await request('/api/session', {
    headers: { Origin: origins.frontend, Cookie: 'darve_session=' + secret },
  });
  assert.equal((await replay.json()).authenticated, false);
  assert.deepEqual(errors, []);
  pass('logout revokes persisted session and prevents cookie replay');
} catch (error) {
  console.error('FAIL ' + phase + ' ' + error.name);
  console.error(
    error.stack?.split('\n').find((line) => line.includes('connected-product-acceptance.mjs')) ??
      '',
  );
  process.exitCode = 1;
} finally {
  await db?.$disconnect();
  await browser?.close();
  await app?.close();
  let state;
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    /* No profile was initialized. */
  }
  if (state) destroyAcceptanceStorage(state);
  assert.equal(
    inspectDevelopmentApi(initialDevelopmentApi.Id).State.Running,
    initialDevelopmentApi.State.Running,
  );
  assert.equal(await portAvailable(5174), true);
  if (!process.exitCode) {
    writeFileSync(
      path.join(directory, 'acceptance.json'),
      JSON.stringify(
        {
          source: app.source,
          migrations: app.migrations,
          checks,
          cleanup: true,
          controlledSession: true,
          externalProviderConsent: false,
        },
        null,
        2,
      ),
    );
    console.log('PASS acceptance storage removed and original API restored');
  }
}
