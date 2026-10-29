import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { startLocalApi } from './local-api.mjs';

const backend = process.argv[2] ?? '../darve-backend';
let api;
let vite;
let browser;
const checks = [];
const origin = 'http://127.0.0.1:4175';
try {
  api = await startLocalApi({ backend, origins: [origin], port: 3310 });
  vite = await createServer({
    mode: 'acceptance-session',
    clearScreen: false,
    server: { host: '127.0.0.1', port: 4175, strictPort: true, hmr: false },
  });
  await vite.listen();
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.name));
  await page.goto(origin + '/tests/fixtures/session.html');
  await page.getByText('Signed out', { exact: true }).waitFor();
  checks.push('real signed-out session');
  const seeded = await api.seedSession();
  await context.addCookies([
    {
      name: 'darve_session',
      value: seeded.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.getByRole('button', { name: 'Refresh session' }).click();
  await page.getByText('Signed in as Synthetic local creator', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Read private profile' }).click();
  await page.getByText('Synthetic local creator', { exact: true }).waitFor();
  checks.push('real persisted session and private profile');
  const peer = await context.newPage();
  peer.on('pageerror', (error) => errors.push(error.name));
  await peer.goto(origin + '/tests/fixtures/session.html');
  await peer.getByText('Signed in as Synthetic local creator', { exact: true }).waitFor();
  await peer.getByRole('textbox', { name: 'Temporary private draft' }).fill('Peer private draft');
  await page
    .getByRole('textbox', { name: 'Temporary private draft' })
    .fill('Private synthetic draft');
  const denied = await page.evaluate(async (base) => {
    const response = await fetch(base + '/api/session/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': 'z'.repeat(43) },
    });
    return response.status;
  }, api.apiOrigin);
  assert.equal(denied, 403);
  assert.equal(await api.revoked(seeded.sessionId), false);
  checks.push('incorrect CSRF rejected without revocation');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByText('Signed out', { exact: true }).waitFor();
  assert.equal(await api.revoked(seeded.sessionId), true);
  assert.equal(await page.getByRole('textbox', { name: 'Temporary private draft' }).count(), 0);
  assert.equal(await page.getByText('Synthetic local creator', { exact: true }).count(), 0);
  // Even replaying the old cookie cannot restore the revoked backend session.
  await context.addCookies([
    {
      name: 'darve_session',
      value: seeded.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const privateStatus = () =>
    page.evaluate(
      async (base) => (await fetch(base + '/api/profile', { credentials: 'include' })).status,
      api.apiOrigin,
    );
  assert.equal(await privateStatus(), 401);
  checks.push('real logout/revocation, private data and draft removed');
  await peer.getByText('Signed out', { exact: true }).waitFor();
  assert.equal(await peer.getByRole('textbox', { name: 'Temporary private draft' }).count(), 0);
  checks.push('confirmed logout invalidates another creator tab and its private draft');
  await peer.close();
  const expires = await api.seedSession({ expiresInMs: 3000 });
  await context.addCookies([
    {
      name: 'darve_session',
      value: expires.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.getByRole('button', { name: 'Refresh session' }).click();
  await page.getByText('Signed in as Synthetic local creator', { exact: true }).waitFor();
  await page.getByText('Your session expired.', { exact: true }).waitFor();
  assert.equal(await privateStatus(), 401);
  checks.push('real session expiration clears browser authority');
  const guestContext = await browser.newContext();
  await guestContext.addCookies([
    {
      name: 'darve_payment_guest',
      value: 'g'.repeat(43),
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const guest = await guestContext.newPage();
  await guest.goto(origin + '/tests/fixtures/session.html');
  await guest.getByText('Signed out', { exact: true }).waitFor();
  checks.push('guest cookie cannot create creator authority');
  const blocked = await fetch(api.apiOrigin + '/api/session/logout', {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:4999' },
  });
  assert.equal(blocked.status, 403);
  checks.push('foreign Origin rejected');
  assert.deepEqual(errors, []);
  const stored = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
  }));
  assert.deepEqual(stored, { local: 0, session: 0 });
  checks.push('no token or private browser storage');
  const artifact = {
    source: api.source,
    migrations: api.migrations,
    checks,
    pageErrors: errors,
    realPostgres: true,
    realRedis: true,
    providerCalls: false,
    externalIdentityVerified: false,
  };
  mkdirSync('artifacts.local/f02-02', { recursive: true });
  writeFileSync('artifacts.local/f02-02/acceptance.json', JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify(artifact));
} finally {
  const cleanup = await Promise.allSettled([browser?.close(), vite?.close(), api?.close()]);
  if (cleanup.some((result) => result.status === 'rejected')) {
    process.stderr.write('Local acceptance cleanup failed; inspect the recorded owned run.\n');
    process.exitCode = 1;
  }
}
