import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { startLocalApi } from './local-api.mjs';

const origin = 'http://127.0.0.1:4175',
  path = '/account/payments';
const options = {
  backend: '../tmp/backend-f06-checkout',
  origins: [origin],
  task: 'f03-04',
  terms: true,
};
const directory = resolve('artifacts.local/f06-05');
const outDir = resolve(directory, 'product-build');
mkdirSync(directory, { recursive: true });
const checks = [];
const pass = (name) => {
  checks.push(name);
  console.log('PASS ' + name);
};
let api,
  site,
  browser,
  context,
  page,
  phase = 'startup',
  result;
const writes = [];
async function creator() {
  await context?.close();
  const actor = await api.seedSession({ expiresInMs: 600_000 });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  await context.route('**/*', (route) =>
    [origin, api.apiOrigin].includes(new URL(route.request().url()).origin)
      ? route.continue()
      : route.abort(),
  );
  await context.addCookies([
    {
      name: 'darve_session',
      value: actor.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  page = await context.newPage();
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.startsWith('/api/payment-accounts/') &&
      ['POST', 'DELETE'].includes(request.method())
    )
      writes.push(new URL(request.url()).pathname);
  });
  await page.goto(origin + path);
  await expect(page.getByRole('heading', { name: 'Read the current account terms' })).toBeVisible();
  await page.getByRole('checkbox', { name: /I have read and accept/ }).check();
  await page.getByRole('button', { name: 'Accept and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Payout settings', exact: true })).toBeVisible();
}
const region = (name) => page.getByRole('region', { name, exact: true });
const dialog = () => page.getByRole('dialog');
const exact = (name) => page.getByRole('button', { name, exact: true });
async function review(button, country = 'US') {
  await exact(button).click();
  await dialog()
    .getByLabel(/Account country code/)
    .fill(country);
  const confirm = dialog().getByRole('button', { name: 'Confirm setup' });
  await expect(confirm).toBeDisabled();
  await dialog().getByRole('checkbox').check();
  await confirm.click();
}
async function accessibility() {
  const report = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  assert.deepEqual(
    report.violations.map((item) => item.id),
    [],
  );
}
try {
  api = await startLocalApi(options);
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  await build({
    configFile: 'vite.config.ts',
    envDir: false,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  site = await preview({
    configFile: 'vite.config.ts',
    logLevel: 'silent',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  });
  browser = await chromium.launch();
  phase = 'signed out and unconfigured';
  const signedOut = await browser.newPage();
  await signedOut.goto(origin + path);
  await expect(
    signedOut.getByRole('heading', { name: 'Connect your stream to Darve' }),
  ).toBeVisible();
  await signedOut.close();
  await creator();
  await expect(region('Stripe').getByText('Setup unavailable', { exact: true })).toBeVisible();
  await expect(region('PayPal').getByText('Setup unavailable', { exact: true })).toBeVisible();
  await expect(exact('Connect PayPal')).toHaveCount(0);
  await expect(exact('Set up a Stripe test account')).toHaveCount(0);
  assert.equal(writes.length, 0);
  await context.close();
  context = undefined;
  await api.close();
  api = undefined;
  pass('session and current terms guard, truthful unconfigured state and read-only entry');
  phase = 'Stripe uncertain setup';
  api = await startLocalApi({ ...options, receiving: true, build: false });
  await creator();
  await expect(region('Stripe').getByText('Not connected', { exact: true })).toBeVisible();
  const sent = [];
  let drop = true;
  const endpoint = api.apiOrigin + '/api/payment-accounts/stripe/onboarding';
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    sent.push([route.request().headers()['idempotency-key'], route.request().postData()]);
    if (!drop) {
      await route.continue();
      return;
    }
    drop = false;
    const response = await route.fetch({ maxRedirects: 0 });
    await route.abort('failed');
    assert.equal(response.status(), 200);
  });
  await review('Set up a Stripe test account');
  await expect(dialog().getByRole('alert')).toContainText('Setup could not be confirmed');
  assert.equal(sent.length, 1);
  await dialog().getByRole('button', { name: 'Back to settings' }).click();
  await expect(exact('Set up a Stripe test account')).toHaveCount(0);
  await exact('Resume reviewed setup').click();
  await dialog().getByRole('button', { name: 'Retry same setup' }).click();
  await expect(dialog().getByRole('link', { name: 'Continue to Stripe' })).toBeVisible();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(api.receivingCounts.stripeCreates, 1);
  await dialog().getByRole('button', { name: 'Back to settings' }).click();
  await expect(region('Stripe').getByText('Receiving verified', { exact: true })).toBeVisible();
  await page.unroute(endpoint);
  pass('explicit setup review and same-key recovery after a committed response is lost');
  phase = 'Stripe stale revoke';
  await exact('Disconnect Stripe').click();
  const confirm = dialog().getByRole('button', { name: 'Confirm disconnect' });
  await expect(confirm).toBeDisabled();
  await dialog().getByRole('checkbox').check();
  const refreshed = await page.evaluate(async (apiOrigin) => {
    const session = await fetch(apiOrigin + '/api/session', { credentials: 'include' }).then(
      (response) => response.json(),
    );
    return (
      await fetch(apiOrigin + '/api/payment-accounts/stripe/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken },
        body: '{}',
      })
    ).status;
  }, api.apiOrigin);
  assert.equal(refreshed, 200);
  await confirm.click();
  await expect(dialog()).toHaveCount(0);
  await expect(region('Stripe').getByRole('alert')).toContainText(
    'connection or setup has changed',
  );
  await exact('Disconnect Stripe').click();
  await dialog().getByRole('checkbox').check();
  await confirm.click();
  await expect(region('Stripe').getByText('Disconnected', { exact: true })).toBeVisible();
  pass('stale disconnect is denied, then a fresh reviewed version succeeds');
  phase = 'PayPal return';
  await review('Connect PayPal');
  await expect(dialog().getByRole('link', { name: 'Continue to PayPal' })).toBeVisible();
  const count = writes.length;
  await page.goto(origin + path + '?merchantId=synthetic&status=success#synthetic');
  await expect(page).toHaveURL(origin + path);
  await expect(region('PayPal').getByText('Setup pending', { exact: true })).toBeVisible();
  await page.reload();
  await expect(region('PayPal').getByText('Setup pending', { exact: true })).toBeVisible();
  const setupGuide = page.getByRole('link', { name: 'Setup guide', exact: true });
  const guidePayPal = page
    .getByRole('list', { name: 'Test receiving status' })
    .getByRole('listitem')
    .filter({ hasText: 'PayPal' });
  await setupGuide.click();
  await expect(guidePayPal).toContainText('Setup pending');
  await page.reload();
  await expect(guidePayPal).toContainText('Setup pending');
  await page.getByRole('link', { name: 'Open payout settings' }).click();
  await expect(region('PayPal').getByText('Setup pending', { exact: true })).toBeVisible();
  assert.equal(writes.length, count);
  await exact('Verify PayPal receiving').click();
  await expect(region('PayPal').getByText('Receiving verified', { exact: true })).toBeVisible();
  await expect(region('PayPal').getByText('Confirmed', { exact: true })).toBeVisible();
  await expect(region('PayPal').getByText('Unconfirmed', { exact: true })).toBeVisible();
  assert.equal(api.receivingCounts.paypalReferrals, 1);
  await exact('Disconnect PayPal').click();
  await dialog().getByRole('checkbox').check();
  await confirm.click();
  await expect(region('PayPal').getByText('Disconnected', { exact: true })).toBeVisible();
  const afterRevoke = writes.length;
  await setupGuide.click();
  await expect(guidePayPal).toContainText('Disconnected');
  assert.equal(writes.length, afterRevoke);
  pass(
    'PayPal consent, clean read-only return and reload, independent wallet/card status and canonical pending/revoked guide state',
  );
  phase = 'Stripe existing account';
  await creator();
  await review('Connect existing Stripe');
  const link = dialog().getByRole('link', { name: 'Continue to Stripe' });
  await expect(link).toBeVisible();
  const state = new URL(await link.getAttribute('href')).searchParams.get('state');
  const callback = await context.request.get(
    api.apiOrigin +
      '/api/payment-accounts/stripe/oauth/callback?' +
      new URLSearchParams({ state, code: 'ac_synthetic' }),
    { maxRedirects: 0 },
  );
  assert.equal(callback.status(), 303);
  assert.equal(callback.headers().location, origin + path);
  const beforeReturn = writes.length;
  await page.goto(callback.headers().location);
  await expect(region('Stripe').getByText('Receiving verified', { exact: true })).toBeVisible();
  assert.equal(writes.length, beforeReturn);
  assert.equal(api.receivingCounts.stripeExchanges, 1);
  assert.equal(api.receivingCounts.stripeCreates, 1);
  pass('existing Stripe callback verifies the canonical binding without creating a new account');
  phase = 'accessibility and expiry';
  await accessibility();
  await page.screenshot({ path: resolve(directory, 'payout-desktop.png') });
  await page.setViewportSize({ width: 320, height: 900 });
  assert.equal(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
    true,
  );
  const paypal = exact('Connect PayPal');
  await paypal.focus();
  await page.keyboard.press('Enter');
  await expect(dialog()).toBeVisible();
  await accessibility();
  await page.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
  await expect(paypal).toBeFocused();
  await page.screenshot({ path: resolve(directory, 'payout-mobile.png'), fullPage: true });
  await exact('Verify Stripe receiving').click();
  await expect(region('Stripe').getByText('Receiving verified', { exact: true })).toBeVisible();
  await expect(region('Stripe').getByText('Verification unavailable', { exact: true })).toBeVisible(
    { timeout: 35_000 },
  );
  pass('320px reflow, keyboard modal focus, axe and expiry of displayed readiness');
  result = {
    source: api.source,
    migrations: api.migrations,
    checks,
    controlledProviderPorts: true,
    externalProviderCalls: false,
  };
} catch (error) {
  console.error('FAIL ' + phase + ' ' + error.name);
  console.error(
    error.stack
      ?.split('\n')
      .find((line) => line.includes('local-payout-settings-acceptance.mjs')) ?? '',
  );
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled([
    browser?.close(),
    site
      ? new Promise((resolve) => {
          site.httpServer.closeAllConnections();
          site.httpServer.close(resolve);
        })
      : undefined,
    api?.close(),
  ]);
  if (cleanup.some((item) => item.status === 'rejected')) {
    console.error('Payout acceptance cleanup requires inspection.');
    process.exitCode = 1;
  }
  if (result && !process.exitCode)
    writeFileSync(
      resolve(directory, 'acceptance.json'),
      JSON.stringify({ ...result, cleanup: true }, null, 2),
    );
}
