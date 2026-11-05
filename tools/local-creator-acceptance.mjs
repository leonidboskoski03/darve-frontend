import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { startLocalApi } from './local-api.mjs';

const origin = 'http://127.0.0.1:4175';
const outDir = resolve('artifacts.local/f03/product-build');
let api, site, browser;
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
  await build({
    envDir: false,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  site = await preview({
    logLevel: 'silent',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  });
  browser = await chromium.launch();
  const context = await browser.newContext(),
    page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.name));
  let acceptancePosts = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/terms/acceptance' && request.method() === 'POST')
      acceptancePosts++;
  });
  await page.goto(origin + '/account');
  await expect(page.getByRole('heading', { name: 'Connect your stream to Darve' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toHaveCount(0);
  checks.push('signed-out account entry renders sign-in without a private profile');
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
  await page.goto(origin + '/account');
  await expect(page.getByRole('heading', { name: 'Read the current account terms' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toHaveCount(0);
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
  const profile = page.getByRole('region', { name: 'Profile', exact: true });
  await expect(profile.getByText('Synthetic local creator', { exact: true })).toBeVisible();
  await expect(page.getByText('Accepted version synthetic-v2.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(profile.getByText('Synthetic local creator', { exact: true })).toBeVisible();
  assert.deepEqual(
    (await new AxeBuilder({ page }).analyze()).violations.map(({ id }) => id),
    [],
  );
  await page.getByRole('link', { name: 'Open payout settings' }).click();
  await expect(page.getByRole('heading', { name: 'Payout settings', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Creator workspace' });
  await expect(nav.getByRole('link', { name: 'Payout settings' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav.getByRole('link', { name: 'Account', exact: true })).not.toHaveAttribute(
    'aria-current',
  );
  await nav.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('main')).toBeFocused();
  await page.keyboard.press('Tab');
  const termsLink = page.getByRole('link', { name: 'Review account terms' });
  await expect(termsLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('You have accepted this version.')).toBeVisible();
  await page.goBack();
  const rejectSession = (route) => route.abort();
  await page.route(api.apiOrigin + '/api/session', rejectSession);
  await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
  await expect(
    page.getByRole('heading', { name: 'Your session could not be checked' }),
  ).toBeVisible();
  await expect(profile).toHaveCount(0);
  await page.unroute(api.apiOrigin + '/api/session', rejectSession);
  await page.getByRole('main').getByRole('button', { name: 'Check session' }).click();
  await expect(profile).toBeVisible();
  await page.getByRole('link', { name: 'Manage streaming connections' }).click();
  checks.push(
    'current account profile and terms survive reload; keyboard, payout and connections navigation work; a failed session read hides the profile until recovery',
  );
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
  const mobile = await browser.newContext({
    viewport: { width: 393, height: 851 },
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobile.newPage();
  const creatorCookie = (value) => ({
    name: 'darve_session',
    value,
    url: api.apiOrigin,
    httpOnly: true,
    sameSite: 'Lax',
  });
  await mobile.addCookies([creatorCookie(seeded.secret)]);
  await mobilePage.goto(origin + '/account');
  const mobileProfile = mobilePage.getByRole('region', { name: 'Profile', exact: true });
  await expect(mobileProfile.getByText('Synthetic local creator', { exact: true })).toBeVisible();
  const openMenu = mobilePage.getByRole('button', { name: 'Open workspace navigation' });
  await openMenu.press('Enter');
  await expect(
    mobilePage.getByRole('dialog').getByRole('link', { name: 'Account', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await mobilePage.keyboard.press('Escape');
  await expect(openMenu).toBeFocused();
  assert.equal(
    await mobilePage.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
    true,
  );
  assert.deepEqual(
    (await new AxeBuilder({ page: mobilePage }).analyze()).violations.map(({ id }) => id),
    [],
  );
  const unnamed = await api.seedSession({ displayName: null, expiresInMs: 15_000 });
  await mobile.addCookies([creatorCookie(unnamed.secret)]);
  await mobilePage.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
  await expect(
    mobilePage.getByRole('heading', { name: 'Read the current account terms' }),
  ).toBeVisible();
  await expect(mobilePage.getByText('Synthetic local creator')).toHaveCount(0);
  await mobilePage.getByRole('checkbox', { name: /synthetic-v2/ }).check();
  await mobilePage.getByRole('button', { name: 'Accept and continue' }).click();
  await expect(mobileProfile.getByText('No display name is available.')).toBeVisible();
  await expect(mobilePage.getByRole('main').getByText(/Your session expired/)).toBeVisible({
    timeout: 18_000,
  });
  await expect(mobileProfile).toHaveCount(0);
  await mobile.close();
  checks.push(
    'mobile account passes keyboard navigation, overflow and axe checks; replacing the actual session cookie clears the prior name, preserves null and hides the profile on client-observed expiry',
  );
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
  const cleanup = await Promise.allSettled([
    browser?.close(),
    site &&
      new Promise((done) => {
        site.httpServer.closeAllConnections();
        site.httpServer.close(done);
      }),
    api?.close(),
  ]);
  if (cleanup.some((result) => result.status === 'rejected')) {
    process.stderr.write('Creator acceptance cleanup failed; inspect the recorded owned run.\n');
    process.exitCode = 1;
  }
}
