import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { startLocalApi } from './local-api.mjs';

const provider = process.argv[2];
if (!['stripe', 'paypal'].includes(provider) || process.argv[3] !== 'F06-06')
  throw Error('Specify an existing sandbox seller and the coordinated F06-06 scope.');
const origin = 'http://127.0.0.1:4175';
const directory = resolve('artifacts.local/f06-06-sellers');
const outDir = resolve(directory, 'product-build');
const name = provider === 'stripe' ? 'Stripe' : 'PayPal';
let api,
  site,
  browser,
  result,
  stage = 'startup';
try {
  api = await startLocalApi({
    backend: '../tmp/backend-f06-checkout',
    origins: [origin],
    task: 'f06-06-seller',
    terms: true,
    sellerObservation: { approval: 'F06-06', provider, sourceRoot: '../darve-backend' },
  });
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  await build({ envDir: false, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  site = await preview({
    logLevel: 'silent',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  });
  browser = await chromium.launch({ headless: provider === 'stripe' });
  const context = await browser.newContext();
  const creator = await api.seedSession({ expiresInMs: 900_000 });
  await context.addCookies([
    {
      name: 'darve_session',
      value: creator.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await context.route(api.apiOrigin + '/**', (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const allowed =
      path === '/api/terms/acceptance' ||
      path === '/api/payment-accounts/' + provider + '/refresh' ||
      (provider === 'paypal' && path === '/api/payment-accounts/paypal/onboarding');
    return ['GET', 'OPTIONS'].includes(request.method()) || allowed
      ? route.continue()
      : route.abort();
  });
  const page = await context.newPage();
  stage = 'product terms';
  await page.goto(origin + '/account/payments');
  await page.getByRole('checkbox', { name: /I have read and accept/ }).check();
  await page.getByRole('button', { name: 'Accept and continue' }).click();
  const card = page.getByRole('region', { name, exact: true });
  if (provider === 'stripe') {
    stage = 'existing Stripe binding';
    await expect(card.getByText('Not connected', { exact: true })).toBeVisible();
    const session = await (await context.request.get(api.apiOrigin + '/api/session')).json();
    await api.sellerFixture.bindExisting(creator.userId, creator.secret, session.csrfToken);
    await page.reload();
    await card.getByRole('button', { name: 'Verify Stripe receiving' }).click();
    await expect(
      card.getByText('Provider verification completed. Check the status above.'),
    ).toBeVisible();
  } else {
    stage = 'existing PayPal consent and verification';
    await expect(card.getByText('Not connected', { exact: true })).toBeVisible();
    await page.bringToFront();
    console.log('PAYPAL_SELLER_WINDOW_READY ' + new Date(Date.now() + 600_000).toISOString());
  }
  await expect(card.getByText('Receiving verified', { exact: true })).toBeVisible({
    timeout: provider === 'paypal' ? 600_000 : 15_000,
  });
  stage = 'canonical status and reload';
  const read = async () => {
    const response = await context.request.get(api.apiOrigin + '/api/payment-accounts/' + provider);
    assert.equal(response.status(), 200);
    return (await response.json()).data;
  };
  const current = await read();
  stage = 'canonical ready test status';
  assert.equal(current.state, 'ready');
  assert.equal(current.environment, 'test');
  stage = 'single referral and provider observation';
  assert.equal(api.sellerFixture.counts.referrals, provider === 'paypal' ? 1 : 0);
  assert.ok(api.sellerFixture.counts.observations >= (provider === 'stripe' ? 2 : 1));
  stage = 'verified status after product reload';
  await page.reload();
  await expect(card.getByText('Receiving verified', { exact: true })).toBeVisible();
  stage = 'unchanged canonical version after reload';
  assert.equal((await read()).version, current.version);
  stage = 'acceptance record';
  result = {
    provider,
    source: api.source,
    migrations: api.migrations,
    genuineReceivingObservation: true,
    sellerConsentThroughProduct: provider === 'paypal',
    verifiedOnReload: true,
    currencyCount: current.currencies.length,
    observations: api.sellerFixture.counts.observations,
    referrals: api.sellerFixture.counts.referrals,
    checkoutEnabled: false,
  };
} catch {
  console.error(name + ' seller verification did not complete at ' + stage + '.');
  // Never serialize an exception, provider payload, URL or browser screenshot here.
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, provider + '-incomplete.json'),
    JSON.stringify(
      {
        provider,
        stage,
        source: api?.source ?? null,
        counts: api?.sellerFixture?.counts ?? null,
        verifiedOnReload: false,
        checkoutEnabled: false,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled([
    browser?.close(),
    site &&
      new Promise((done) => {
        site.httpServer.closeAllConnections();
        site.httpServer.close(done);
      }),
    api?.close(),
  ]);
  if (cleanup.some(({ status }) => status === 'rejected')) process.exitCode = 1;
  if (result && !process.exitCode) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, provider + '.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
}
