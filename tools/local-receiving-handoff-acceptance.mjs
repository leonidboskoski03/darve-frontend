import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { startLocalApi } from './local-api.mjs';
import { enterWalkthrough, finishWalkthrough } from './local-core-walkthrough.mjs';

const walkthrough = process.argv.includes('--core-walkthrough');
const origin = walkthrough ? 'http://localhost:4177' : 'http://127.0.0.1:4177';
const directory = resolve(
  walkthrough ? 'artifacts.local/f01-05-connected' : 'artifacts.local/f06-06',
);
const outDir = resolve(directory, 'product-build');
const checks = [];
let api,
  site,
  browser,
  result,
  phase = 'runtime startup';
try {
  api = await startLocalApi({
    backend: process.argv[2] ?? '../tmp/backend-f06-checkout',
    origins: [origin],
    task: walkthrough ? 'f01-05' : 'f06-06',
    port: 3311,
    collection: true,
    review: true,
    terms: true,
    receiving: true,
    overlay: walkthrough,
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
  const owner = await browser.newContext();
  const guest = await browser.newContext({
    viewport: { width: 393, height: 851 },
    isMobile: true,
    hasTouch: true,
  });
  if (walkthrough) {
    owner.setDefaultTimeout(10_000);
    guest.setDefaultTimeout(10_000);
  }
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
  phase = 'signed-in creator entry';
  const creator = walkthrough
    ? await enterWalkthrough({ origin, apiOrigin: api.apiOrigin, owner, page })
    : await api.seedSession({ expiresInMs: 600_000 });
  if (!walkthrough) {
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
  }
  await api.collectionFixture.seed(creator.userId, 'TWITCH');
  api.collectionFixture.capacity('available');
  phase = 'current terms and setup guide';
  await page.getByRole('link', { name: 'Review account terms' }).click();
  await expect(page.getByRole('button', { name: 'Accept and continue' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I have read and accept/ }).check();
  await page.getByRole('button', { name: 'Accept and continue' }).click();
  await page.getByRole('link', { name: 'Return to setup guide' }).click();
  if (walkthrough) {
    const nav = page.getByRole('navigation', { name: 'Creator workspace' });
    await nav.getByRole('link', { name: 'Account', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Profile' })).toContainText(
      'Synthetic walkthrough creator',
    );
    await page.getByRole('link', { name: 'Manage streaming connections' }).click();
    await expect(page.getByRole('heading', { name: 'Your streaming accounts' })).toBeVisible();
    await expect(page.getByText('Synthetic collection channel', { exact: true })).toBeVisible();
    await nav.getByRole('link', { name: 'Setup guide' }).click();
    await page.getByRole('link', { name: 'Open OBS display setup' }).click();
    await expect(page.getByText(/In OBS: add a Browser Source/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create private OBS link' })).toBeDisabled();
    await nav.getByRole('link', { name: 'Setup guide' }).click();
    checks.push(
      'Actual OAuth start/callback and current terms open the private account, connected source and OBS instructions.',
    );
  }
  await page.getByRole('link', { name: 'Continue to dashboard' }).click();
  phase = 'dashboard collection entry';
  const collection = page.getByRole('region', { name: 'Collection', exact: true });
  await collection.getByRole('link', { name: 'Open collection setup' }).click();
  phase = 'receiving-required Start denial';
  const selectSource = () =>
    page.getByLabel('Connected account').selectOption({ label: 'Synthetic collection channel' });
  if (walkthrough) await selectSource();
  const start = page.getByRole('button', { name: 'Start collection', exact: true });
  await start.click();
  await expect(page.getByRole('alert')).toContainText('ready receiving account');
  assert.equal(await api.collectionFixture.roundCount(creator.userId), 0);
  phase = 'payout setup entry';
  await page.getByRole('link', { name: 'Open payout settings' }).click();
  const paypal = page.getByRole('region', { name: 'PayPal', exact: true });
  await expect(paypal.getByText('Not connected', { exact: true })).toBeVisible();
  assert.deepEqual(writes, []);
  checks.push(
    'Dashboard and Collection defer Start until a real persisted receiving binding exists, with a direct remedy.',
  );
  phase = 'reviewed payout referral';
  await paypal.getByRole('button', { name: 'Connect PayPal' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Account country code/).fill('US');
  const confirm = dialog.getByRole('button', { name: 'Confirm setup' });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await confirm.click();
  await expect(dialog.getByRole('link', { name: 'Continue to PayPal' })).toBeVisible();
  phase = 'pending PayPal return and reload';
  await page.goto(origin + '/account/payments?status=success&merchantId=synthetic#untrusted');
  await expect(page).toHaveURL(origin + '/account/payments');
  await expect(paypal.getByText('Setup pending', { exact: true })).toBeVisible();
  await page.reload();
  await expect(paypal.getByText('Setup pending', { exact: true })).toBeVisible();
  assert.equal(writes.length, 1);
  phase = 'explicit PayPal verification and reload';
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
  phase = 'dashboard verified receiving and Start';
  await expect(
    page.getByRole('list', { name: 'Test receiving status' }).getByText('Receiving verified'),
  ).toBeVisible();
  await collection.getByRole('link', { name: 'Open collection setup' }).click();
  if (walkthrough) await selectSource();
  await page.getByLabel('Collection duration').fill('60');
  await start.click();
  phase = 'collection resume and acceptance';
  await expect(page.getByRole('heading', { name: 'Preparing your collection' })).toBeVisible();
  const roundId = new URL(page.url()).pathname.split('/').at(-1);
  if (walkthrough) {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Preparing your collection' })).toBeVisible();
    assert.equal(await api.collectionFixture.roundCount(creator.userId), 1);
  }
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
  const challengeDetails = page.getByRole('link', {
    name: 'View challenge details and declaration',
  });
  const challengePath = await challengeDetails.getAttribute('href');
  assert.match(challengePath, /^\/challenges\/[a-f0-9-]{36}$/);
  await challengeDetails.click();
  const publicLink = await page
    .getByRole('link', { name: 'Open public contribution page' })
    .getAttribute('href');
  assert.match(publicLink, /^\/contribute\/[a-f0-9-]{36}$/);
  assert.deepEqual(await api.reviewFixture.counts(creator.userId), { challenges: 1, receipts: 1 });
  checks.push(
    'Verified receiving enables the actual collection, Stop, acceptance and owner-to-public link.',
  );
  await viewer.goto(origin + publicLink);
  phase = 'guest readiness and receiving disconnect';
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
  if (walkthrough) {
    await finishWalkthrough({
      origin,
      apiOrigin: api.apiOrigin,
      browser,
      owner,
      page,
      challengePath,
      setPhase(value) {
        phase = value;
      },
    });
    checks.push(
      'Retained history, explicit OBS selection and dashboard display agree on desktop and narrow mobile. Mobile sign-out revokes the creator session.',
    );
  }
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
    ...(walkthrough
      ? {
          frontendRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
          controlledIdentityAndStream: true,
          externalCalls: false,
        }
      : {}),
  };
} catch (error) {
  if (!walkthrough) throw error;
  console.error('Connected core walkthrough failed at ' + phase + ' (' + error.name + ').');
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
    writeFileSync(resolve(directory, 'acceptance.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
}
