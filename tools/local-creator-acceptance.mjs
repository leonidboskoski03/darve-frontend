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
    task: 'f03',
    terms: true,
  });
  // Process-local public configuration for the regular application entry. No env file is read.
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  vite = await createServer({
    clearScreen: false,
    envDir: false,
    server: { host: '127.0.0.1', port: 4175, strictPort: true, hmr: false },
  });
  await vite.listen();
  browser = await chromium.launch();
  const context = await browser.newContext(),
    page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.name));
  let acceptancePosts = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/terms/acceptance' && request.method() === 'POST')
      acceptancePosts++;
  });
  await page.goto(origin + '/authorize');
  await expect(page.getByRole('button', { name: 'Continue with Twitch' })).toBeEnabled();
  for (const provider of ['Twitch', 'YouTube', 'Kick']) {
    await page.getByRole('button', { name: 'Continue with ' + provider }).click();
    await expect(page.getByRole('alert')).toContainText('not configured or is unavailable');
    await expect(page.getByRole('heading', { name: 'Connect your stream to Darve' })).toBeVisible();
  }
  checks.push(
    'actual signed-out creator entry and explicit unavailable start for all three providers',
  );
  const seeded = await api.seedSession({ expiresInMs: 180_000 });
  await context.addCookies([
    {
      name: 'darve_session',
      value: seeded.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(origin + '/integrations');
  await expect(page.getByRole('heading', { name: 'Read the current account terms' })).toBeVisible();
  const checkbox = page.getByRole('checkbox', { name: /I have read and accept/ });
  await expect(page.getByRole('button', { name: 'Accept and continue' })).toBeDisabled();
  await expect(page.getByText('Development document · local testing only')).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Current account terms' }).locator('b'),
  ).toHaveCount(0);
  checks.push(
    'real persisted session loads exact development document as text with explicit unchecked consent',
  );
  const denied = await page.evaluate(
    async (base) =>
      (
        await fetch(base + '/api/terms/acceptance', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'z'.repeat(43) },
          body: '{}',
        })
      ).status,
    api.apiOrigin,
  );
  assert.equal(denied, 403);
  checks.push('actual terms mutation rejects an incorrect CSRF proof');
  await checkbox.check();
  await api.replaceTermsFixture();
  const beforeStale = acceptancePosts;
  await page.getByRole('button', { name: 'Accept and continue' }).click();
  await expect(page.getByRole('checkbox', { name: /synthetic-v2/ })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Accept and continue' })).toBeDisabled();
  assert.equal(acceptancePosts, beforeStale + 1);
  checks.push(
    'actual stale document returns conflict, refreshes current version and resets consent without replay',
  );
  await page.getByRole('checkbox', { name: /synthetic-v2/ }).check();
  await page.getByRole('button', { name: 'Accept and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your streaming accounts' })).toBeVisible();
  for (const provider of ['Twitch', 'YouTube', 'Kick'])
    await expect(page.getByRole('heading', { name: provider, exact: true })).toBeVisible();
  await expect(page.getByText('No account is connected.', { exact: true })).toHaveCount(3);
  checks.push(
    'real terms acceptance persists and reveals authoritative empty three-provider connections',
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your streaming accounts' })).toBeVisible();
  await page.goto(origin + '/terms');
  await expect(page.getByText('You have accepted this version.')).toBeVisible();
  checks.push('accepted version survives full browser reload and actual private terms review');
  const guest = await browser.newContext();
  await guest.addCookies([
    {
      name: 'darve_payment_guest',
      value: 'g'.repeat(43),
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const guestPage = await guest.newPage();
  await guestPage.goto(
    origin +
      '/integrations?oauth_provider=twitch&oauth_result=success&code=synthetic-private&state=synthetic-private',
  );
  await expect(
    guestPage.getByText('No signed-in session was established. Try connecting again.'),
  ).toBeVisible();
  assert.equal(new URL(guestPage.url()).searchParams.has('code'), false);
  await expect(guestPage.getByRole('heading', { name: 'Your streaming accounts' })).toHaveCount(0);
  checks.push(
    'guest proof and a forged success hint cannot create creator authority; callback secrets are removed',
  );
  await guest.close();
  await api.replaceTermsFixture({ configured: false });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Account terms are unavailable' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  checks.push('missing server terms stay unavailable and cannot be accepted');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect your stream to Darve' })).toBeVisible();
  assert.equal(await api.revoked(seeded.sessionId), true);
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  assert.deepEqual(errors, []);
  checks.push('real logout revokes the fixture session and leaves no private browser storage');
  const record = {
    source: api.source,
    migrations: api.migrations,
    checks,
    pageErrors: errors,
    realPostgres: true,
    realRedis: true,
    externalProviderExchange: false,
    externalIdentityVerified: false,
    providerCalls: false,
  };
  mkdirSync('artifacts.local/f03', { recursive: true });
  writeFileSync('artifacts.local/f03/acceptance.json', JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
} finally {
  const cleanup = await Promise.allSettled([browser?.close(), vite?.close(), api?.close()]);
  if (cleanup.some((result) => result.status === 'rejected')) {
    process.stderr.write('Creator acceptance cleanup failed; inspect the recorded owned run.\n');
    process.exitCode = 1;
  }
}
