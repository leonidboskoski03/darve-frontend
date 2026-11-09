import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { startLocalApi } from './local-api.mjs';

const origin = 'http://127.0.0.1:4177';
const directory = resolve('artifacts.local/f06-06');
const outDir = resolve(directory, 'product-build');
const checks = [];
let api, site, browser, result;
try {
  api = await startLocalApi({
    backend: process.argv[2] ?? '../tmp/backend-f06-checkout',
    origins: [origin],
    task: 'f06-06',
    port: 3311,
    collection: true,
    review: true,
    terms: true,
    receiving: true,
  });
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  await build({ envDir: false, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  site = await preview({
    logLevel: 'silent',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 4177, strictPort: true },
  });
  browser = await chromium.launch();
  const creator = await api.seedSession({ expiresInMs: 600_000 });
  await api.collectionFixture.seed(creator.userId, 'TWITCH');
  api.collectionFixture.capacity('available');
  const owner = await browser.newContext();
  const guest = await browser.newContext({
    viewport: { width: 393, height: 851 },
    isMobile: true,
    hasTouch: true,
  });
  const pages = [];
  for (const context of [owner, guest]) {
    await context.route('**/*', (route) =>
      [origin, api.apiOrigin].includes(new URL(route.request().url()).origin)
        ? route.continue()
        : route.abort(),
    );
    pages.push(await context.newPage());
  }
  const [page, viewer] = pages;
  const errors = [];
  for (const entry of pages) entry.on('pageerror', (error) => errors.push(error.name));
  const writes = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/payment-accounts/') && !['GET', 'OPTIONS'].includes(request.method()))
      writes.push(path);
  });
  await owner.addCookies([
    {
      name: 'darve_session',
      value: creator.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(origin + '/onboarding');
  await page.getByRole('link', { name: 'Review account terms' }).click();
  await page.getByRole('checkbox', { name: /I have read and accept/ }).check();
  await page.getByRole('button', { name: 'Accept and continue' }).click();
  await page.getByRole('link', { name: 'Return to setup guide' }).click();
  await page.getByRole('link', { name: 'Continue to dashboard' }).click();
  const collection = page.getByRole('region', { name: 'Collection', exact: true });
  await collection.getByRole('link', { name: 'Open collection setup' }).click();
  const start = page.getByRole('button', { name: 'Start collection', exact: true });
  await start.click();
  await expect(page.getByRole('alert')).toContainText('ready receiving account');
  assert.equal(await api.collectionFixture.roundCount(creator.userId), 0);
  await page.getByRole('link', { name: 'Open payout settings' }).click();
  const paypal = page.getByRole('region', { name: 'PayPal', exact: true });
  await expect(paypal.getByText('Not connected', { exact: true })).toBeVisible();
  assert.deepEqual(writes, []);
  checks.push(
    'Dashboard and Collection defer Start until a real persisted receiving binding exists, with a direct remedy.',
  );
  await paypal.getByRole('button', { name: 'Connect PayPal' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Account country code/).fill('US');
  const confirm = dialog.getByRole('button', { name: 'Confirm setup' });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await confirm.click();
  await expect(dialog.getByRole('link', { name: 'Continue to PayPal' })).toBeVisible();
  await page.goto(origin + '/account/payments?status=success&merchantId=synthetic#untrusted');
  await expect(page).toHaveURL(origin + '/account/payments');
  await expect(paypal.getByText('Setup pending', { exact: true })).toBeVisible();
  await page.reload();
  await expect(paypal.getByText('Setup pending', { exact: true })).toBeVisible();
  assert.equal(writes.length, 1);
  await paypal.getByRole('button', { name: 'Verify PayPal receiving' }).click();
  await expect(paypal.getByText('Receiving verified', { exact: true })).toBeVisible();
  await page.reload();
  await expect(paypal.getByText('Receiving verified', { exact: true })).toBeVisible();
  assert.equal(api.receivingCounts.paypalReferrals, 1);
  assert.equal(api.receivingCounts.stripeCreates, 0);
  assert.equal(writes.length, 2);
  checks.push(
    'Reviewed setup, cleaned return, pending reload and explicit verified receiving all use one seller referral.',
  );
  await page
    .getByRole('navigation', { name: 'Creator workspace' })
    .getByRole('link', { name: 'Dashboard' })
    .click();
  await expect(
    page.getByRole('list', { name: 'Test receiving status' }).getByText('Receiving verified'),
  ).toBeVisible();
  await collection.getByRole('link', { name: 'Open collection setup' }).click();
  await page.getByLabel('Collection duration').fill('60');
  await start.click();
  await expect(page.getByRole('heading', { name: 'Preparing your collection' })).toBeVisible();
  const roundId = new URL(page.url()).pathname.split('/').at(-1);
  await api.collectionFixture.recover();
  await expect(page.getByRole('heading', { name: 'Collecting viewer ideas' })).toBeVisible();
  await api.collectionFixture.admitIdeas(creator.userId, roundId);
  await page.getByRole('button', { name: 'Stop collection', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm stop' }).click();
  await expect(page.getByRole('heading', { name: 'Collection ended' })).toBeVisible();
  await api.reviewFixture.publish(creator.userId, roundId);
  await page.getByRole('link', { name: 'Review viewer ideas' }).click();
  await page.getByRole('button', { name: 'Accept idea 1', exact: true }).click();
  await page.getByLabel('Funding goal', { exact: true }).fill('25.50');
  await page.getByLabel('Funding duration in seconds', { exact: true }).fill('600');
  await page.getByRole('button', { name: 'Review exact terms' }).click();
  await page.getByRole('button', { name: 'Confirm acceptance' }).click();
  await page.getByRole('link', { name: 'View challenge details and declaration' }).click();
  const publicLink = await page
    .getByRole('link', { name: 'Open public contribution page' })
    .getAttribute('href');
  assert.match(publicLink, /^\/contribute\/[a-f0-9-]{36}$/);
  assert.deepEqual(await api.reviewFixture.counts(creator.userId), { challenges: 1, receipts: 1 });
  checks.push(
    'Verified receiving enables the actual collection, Stop, acceptance and owner-to-public link.',
  );
  await viewer.goto(origin + publicLink);
  const methods = viewer.getByLabel('Payment method');
  await expect(methods.getByRole('option', { name: 'PayPal', exact: true })).toHaveCount(1);
  await expect(methods.getByRole('option', { name: 'Stripe', exact: true })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Prepare checkout' })).toBeDisabled();
  assert.deepEqual(await guest.cookies(api.apiOrigin), []);
  await page.goto(origin + '/account/payments');
  await paypal.getByRole('button', { name: 'Disconnect PayPal' }).click();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirm disconnect' }).click();
  await expect(paypal.getByText('Disconnected', { exact: true })).toBeVisible();
  await viewer.getByRole('button', { name: 'Refresh challenge' }).click();
  await expect(methods).toHaveCount(0);
  assert.deepEqual(await api.receivingHandoffAudit(), { attempts: 0, payments: 0 });
  assert.equal(writes.length, 3);
  assert.deepEqual(errors, []);
  checks.push(
    'A fresh guest sees only the ready payment method. Disconnect removes checkout readiness on refresh with no payment attempt.',
  );
  result = {
    source: api.source,
    migrations: api.migrations,
    checks,
    controlledProviderPorts: true,
    checkoutAttempts: 0,
    payments: 0,
  };
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
    writeFileSync(resolve(directory, 'acceptance.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
}
