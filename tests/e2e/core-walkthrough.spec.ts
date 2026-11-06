import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  dashboardFixture,
  syntheticReportingSession,
} from '../../src/services/reporting/fixture.test-helper';
import { makeFrame } from '../../src/services/realtime/fixtures.test-support';

// These cases exercise real routes with synthetic HTTP. They do not qualify OAuth,
// seller consent, connected SQL, native OBS or the final F01-05 walkthrough.
const fixture = 'http://127.0.0.1:4175/tests/fixtures/creator.html?view=terms';
const api = 'http://127.0.0.1:3310';
const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4175',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'X-CSRF-Token,Content-Type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
const signedOut = { authenticated: false, user: null, expiresAt: null, csrfToken: null };
const terms = {
  documentId: 'synthetic',
  version: 'v1',
  classification: 'development',
  contentHash: 'a'.repeat(64),
  content: 'Synthetic local walkthrough terms. No real account or payment.',
};

async function scenario(page: Page, accepted = false) {
  const state = {
    accepted,
    signedIn: true,
    sessionUnavailable: false,
    paypal: 'pending' as 'pending' | 'ready' | 'revoked',
    receivingUnavailable: false,
    mutations: [] as string[],
    unexpected: [] as string[],
    errors: [] as string[],
  };
  page.on('pageerror', (error) => state.errors.push(error.name));
  const envelope = (data: unknown) => ({
    schemaVersion: 1,
    serverTime: new Date().toISOString(),
    data,
  });
  const reply = (route: Route, data: unknown, status = 200) =>
    route.fulfill({
      status,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  const failure = () => ({
    schemaVersion: 1,
    serverTime: new Date().toISOString(),
    error: {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Synthetic private diagnostic must not render.',
      requestId: 'synthetic-walkthrough',
      retryable: false,
      retryAfterSeconds: null,
      issues: [],
      refetch: null,
    },
  });
  await page.route(api + '/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (method !== 'GET') state.mutations.push(method + ' ' + path);
    if (path === '/api/session') {
      if (state.sessionUnavailable) return route.abort('failed');
      const session = structuredClone(syntheticReportingSession);
      if (!state.accepted)
        Object.assign(session.user.termsStatus, {
          status: 'required',
          acceptedVersion: null,
          acceptedAt: null,
        });
      return reply(route, state.signedIn ? session : signedOut);
    }
    if (path === '/api/terms/current') return reply(route, envelope(terms));
    if (path === '/api/terms/acceptance' && method === 'POST') {
      expect(request.headers()['x-csrf-token']).toBe(syntheticReportingSession.csrfToken);
      expect(request.postDataJSON()).toEqual({
        documentId: terms.documentId,
        version: terms.version,
        contentHash: terms.contentHash,
        accepted: true,
      });
      state.accepted = true;
      return reply(route, envelope(syntheticReportingSession.user.termsStatus));
    }
    if (path === '/api/session/logout' && method === 'POST') {
      state.signedIn = false;
      return route.fulfill({ status: 204, headers: cors });
    }
    if (!state.signedIn) return reply(route, failure(), 401);
    if (
      path === '/api/connections' ||
      path === '/api/challenges' ||
      path === '/api/challenges/current'
    )
      return reply(route, envelope({ items: [], nextCursor: null }));
    if (path === '/api/rounds/current') return reply(route, envelope(null));
    if (path === '/api/dashboard/summary') {
      const summary = dashboardFixture();
      summary.period.timeZone = new URL(request.url()).searchParams.get('timeZone')!;
      summary.history = {
        acceptedChallenges: 0,
        historicallyFundedChallenges: 0,
        streamerDeclaredCompletions: 0,
        contributionsByCurrency: [],
      };
      summary.recentActivity = { items: [], hasMore: false };
      return reply(route, envelope(summary));
    }
    if (path === '/api/overlay-preferences')
      return reply(route, {
        schemaVersion: 2,
        serverTime: new Date().toISOString(),
        data: makeFrame(2).data.preferences,
      });
    if (path === '/api/payment-accounts/paypal/refresh' && method === 'POST')
      state.paypal = 'ready';
    if (
      [
        '/api/payment-accounts/stripe',
        '/api/payment-accounts/paypal',
        '/api/payment-accounts/paypal/refresh',
      ].includes(path)
    ) {
      if (state.receivingUnavailable) return reply(route, failure(), 503);
      const stripe = path.endsWith('/stripe');
      const ready = !stripe && state.paypal === 'ready';
      return reply(
        route,
        envelope({
          environment: 'test',
          state: stripe ? 'unconfigured' : state.paypal,
          version: stripe ? null : ready ? 2 : 1,
          country: stripe ? null : 'US',
          currencies: ready ? ['USD'] : [],
          observedAt: ready ? new Date().toISOString() : null,
          validUntil: ready ? new Date(Date.now() + 60_000).toISOString() : null,
          ...(stripe ? {} : { walletActive: ready, cardsActive: false }),
        }),
      );
    }
    state.unexpected.push(method + ' ' + path);
    return reply(route, failure(), 404);
  });
  return state;
}

async function navigate(page: Page, label: string, heading: string) {
  const menu = page.getByRole('button', {
    name: 'Open workspace navigation',
    includeHidden: true,
  });
  await expect(menu).toBeAttached();
  if (await menu.isVisible()) {
    await menu.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Creator workspace' });
    await dialog.getByRole('link', { name: label, exact: true }).focus();
  } else {
    await page
      .getByRole('navigation', { name: 'Creator workspace' })
      .getByRole('link', { name: label, exact: true })
      .focus();
  }
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('main')).toBeFocused();
}

async function audit(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(result.violations).toEqual([]);
}

test('synthetic core walkthrough joins reviewed terms, setup, account and empty workspaces with keyboard navigation and sign-out', async ({
  page,
}, info) => {
  const state = await scenario(page);
  if (info.project.name.startsWith('mobile'))
    await page.setViewportSize({ width: 320, height: 851 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fixture);
  const accept = page.getByRole('button', { name: 'Accept and continue' });
  await expect(accept).toBeDisabled();
  await page.getByRole('checkbox', { name: /I have read and accept/ }).check();
  await accept.click();
  await expect(page.getByText('You have accepted this version.')).toBeVisible();
  for (const [label, heading] of [
    ['Setup guide', 'Set up your stream'],
    ['Account', 'Account settings'],
    ['Connections', 'Your streaming accounts'],
    ['Payout settings', 'Payout settings'],
    ['OBS display', 'OBS display'],
    ['Dashboard', 'Dashboard'],
    ['Collection', 'Start collection'],
    ['Challenge history', 'Challenge history'],
  ]) {
    await navigate(page, label, heading);
    await audit(page);
    if (label === 'OBS display')
      await expect(page.getByRole('button', { name: 'Create private OBS link' })).toBeDisabled();
  }
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect your stream to Darve' })).toBeVisible();
  await expect(page.getByText('Synthetic reporting creator', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Challenge history' })).toHaveCount(0);
  expect(state.mutations).toEqual(['POST /api/terms/acceptance', 'POST /api/session/logout']);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('synthetic cross-screen session uncertainty removes private setup and cannot reuse it on another account route', async ({
  page,
}) => {
  const state = await scenario(page, true);
  await page.goto(fixture);
  await navigate(page, 'Setup guide', 'Set up your stream');
  state.sessionUnavailable = true;
  await page.getByRole('button', { name: 'Check setup status' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your session could not be checked' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Set up your stream' })).toHaveCount(0);
  await expect(page.getByText('Synthetic reporting creator', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await page
    .getByRole('dialog', { name: 'Explore Darve' })
    .getByRole('link', { name: 'Account settings', exact: true })
    .click();
  await expect(page).toHaveURL('http://127.0.0.1:4175/account');
  await expect(
    page.getByRole('heading', { name: 'Your session could not be checked' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Account settings', exact: true })).toHaveCount(0);
  state.sessionUnavailable = false;
  state.signedIn = false;
  await page.getByRole('main').getByRole('button', { name: 'Check session', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect your stream to Darve' })).toBeVisible();
  expect(state.mutations).toEqual([]);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('synthetic core navigation preserves pending, verified and revoked receiving boundaries and hides stale status on failure', async ({
  page,
}) => {
  const state = await scenario(page, true);
  await page.goto(fixture);
  await navigate(page, 'Payout settings', 'Payout settings');
  const paypal = page.getByRole('region', { name: 'PayPal', exact: true });
  await expect(paypal.getByText('Setup pending', { exact: true })).toBeVisible();
  await expect(paypal.getByText('Receiving verified', { exact: true })).toHaveCount(0);
  await paypal.getByRole('button', { name: 'Verify PayPal receiving' }).click();
  await expect(paypal.getByText('Receiving verified', { exact: true })).toBeVisible();
  await navigate(page, 'Setup guide', 'Set up your stream');
  await expect(
    page.getByRole('list', { name: 'Test receiving status' }).getByText('Receiving verified'),
  ).toBeVisible();
  state.paypal = 'revoked';
  await navigate(page, 'Payout settings', 'Payout settings');
  await expect(paypal.getByText('Disconnected', { exact: true })).toBeVisible();
  await expect(paypal.getByRole('button', { name: 'Connect PayPal', exact: true })).toBeVisible();
  state.receivingUnavailable = true;
  await paypal.getByRole('button', { name: 'Check PayPal status' }).click();
  await expect(paypal.getByText('Status unavailable', { exact: true })).toBeVisible();
  await expect(paypal.getByRole('button', { name: 'Connect PayPal', exact: true })).toHaveCount(0);
  await expect(page.getByText('Synthetic private diagnostic must not render.')).toHaveCount(0);
  expect(state.mutations).toEqual(['POST /api/payment-accounts/paypal/refresh']);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
});
