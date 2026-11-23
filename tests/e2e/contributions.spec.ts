import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  contributionIds as ids,
  publicContributionFixture,
  privateReceiptFixture,
} from '../../src/services/contributions/fixture.test-helper';
const base = 'http://127.0.0.1:4175/tests/fixtures/contribution.html';
const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4175',
  'access-control-allow-credentials': 'true',
};
const wire = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    headers: { ...cors, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const error = {
  schemaVersion: 1,
  error: {
    code: 'UNAUTHORIZED',
    message: 'private raw text must not render',
    requestId: 'synthetic-request',
    retryAfterSeconds: null,
  },
};
async function fixture(page: Page) {
  const state = {
    public: publicContributionFixture(),
    receipt: privateReceiptFixture(),
    receiptStatus: 200,
    selected: null as string | null,
    requests: [] as { pathname: string; method: string }[],
  };
  await page.route('http://127.0.0.1:3310/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    state.requests.push({ pathname: url.pathname, method: request.method() });
    if (url.pathname === '/api/public/viewer-links/test-creator') {
      expect(request.headers().cookie).toBeUndefined();
      await wire(route, { publicId: state.selected });
    } else if (url.pathname === '/api/public/challenges/' + ids.public)
      await wire(route, state.public);
    else if (url.pathname === '/api/checkouts/' + ids.checkout)
      await wire(route, state.receiptStatus === 200 ? state.receipt : error, state.receiptStatus);
    else await wire(route, error, 404);
  });
  return state;
}
test('short link re-resolves after an empty display and opens a new contribution document', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.route('**/contribute/' + ids.public, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Current challenge document</h1>',
    }),
  );
  await open(page, 'view=short&slug=TEST-CREATOR');
  await expect(page.getByRole('heading', { name: 'No open challenge right now' })).toBeVisible();
  state.selected = ids.public;
  await open(page, 'view=short&slug=TEST-CREATOR');
  await expect(page).toHaveURL(/\/contribute\//);
  await expect(page.getByRole('heading', { name: 'Current challenge document' })).toBeVisible();
  expect(
    state.requests.filter(({ pathname }) => pathname.startsWith('/api/public/viewer-links/')),
  ).toHaveLength(2);
  noCommands(state.requests);
});
async function open(page: Page, query: string) {
  await page.goto(base + '?' + query, { waitUntil: 'domcontentloaded' });
}
function noCommands(requests: { pathname: string; method: string }[]) {
  expect(requests.every((row) => row.method === 'GET')).toBe(true);
  expect(requests.some((row) => row.pathname === '/api/session')).toBe(false);
}
async function capture(page: Page, name: string, project: string) {
  if (!process.env.F06_CAPTURE_DIR) return;
  await mkdir(process.env.F06_CAPTURE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(process.env.F06_CAPTURE_DIR, name + '-' + project + '.png'),
    fullPage: true,
  });
}
test('compact public page shows challenge and exact funding and keeps technical details collapsed', async ({
  page,
}, info) => {
  const state = await fixture(page);
  await open(page, 'view=public&publicId=' + ids.public);
  await expect(
    page.getByRole('heading', { name: 'Draw a creature chosen by the community', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.contribution-raised')).toContainText('10.00 EUR');
  await expect(page.getByText('Synthetic contribution creator', { exact: true })).toBeVisible();
  await expect(page.locator('.contribution-raised')).toContainText('10.00 EUR of 123.45 EUR');
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '8');
  await expect(page.getByRole('status')).toContainText('Contributions unavailable');
  await expect(page.getByText('Payments are not enabled', { exact: false }).first()).toBeHidden();
  await page.getByText('Details', { exact: true }).click();
  await expect(page.getByText('Payments are not enabled', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /pay|checkout|capture/i })).toHaveCount(0);
  await page.getByText('All 3 projected author credits', { exact: true }).click();
  await expect(page.getByText('Same viewer · twitch', { exact: true })).toBeVisible();
  await expect(page.getByText('Same viewer · youtube', { exact: true })).toBeVisible();
  await expect(
    page.getByText('<img src=x onerror=alert(1)> · kick', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.contribution-card img')).toHaveCount(0);
  noCommands(state.requests);
  await capture(page, 'public', info.project.name);
});
test('public funding updates the eligible total before reaching the goal without a reload', async ({
  page,
}) => {
  const state = await fixture(page);
  state.public = publicContributionFixture(true);
  await open(page, 'view=public&publicId=' + ids.public);
  await expect(page.getByText('Open for contributions', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.contribution-raised')).toContainText('10.00 EUR');
  state.public.data.funding.revision++;
  state.public.data.funding.confirmedGross = '1507';
  state.public.data.funding.eligibleGross = '1500';
  await expect(page.locator('.contribution-raised')).toContainText('15.00 EUR', {
    timeout: 10_000,
  });
  await expect(page.getByText('Open for contributions', { exact: true }).first()).toBeVisible();

  state.public.data.funding.revision++;
  state.public.data.funding.state = 'funded';
  state.public.data.funding.goalReachedAt = state.public.serverTime;
  state.public.data.funding.checkoutAvailability = state.public.data.checkoutAvailability = {
    available: false,
    reasonCode: 'goal_reached',
  };
  for (const row of state.public.data.availablePaymentProviders)
    row.availability = state.public.data.checkoutAvailability;
  await expect(page.getByText('Goal reached — thank you!', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  noCommands(state.requests);
});
test('synthetic unavailable source hides creator/text/credits and server reason stays visible', async ({
  page,
}) => {
  const state = await fixture(page);
  state.public.data.contentAvailability = 'unavailable';
  state.public.data.checkoutAvailability = { available: false, reasonCode: 'source_unavailable' };
  await open(page, 'view=public&publicId=' + ids.public);
  await expect(
    page.getByRole('heading', { name: 'Challenge content unavailable', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Synthetic contribution creator', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Draw a creature chosen by the community', { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Contributions unavailable');
  noCommands(state.requests);
});
for (const reason of ['deadline_passed', 'goal_reached', 'reconciliation_required'] as const)
  test(`synthetic ${reason} is a server-owned unavailable state`, async ({ page }) => {
    const state = await fixture(page);
    state.public.data.checkoutAvailability = { available: false, reasonCode: reason };
    await open(page, 'view=public&publicId=' + ids.public);
    await expect(page.getByRole('status')).toHaveText(
      {
        deadline_passed: 'Funding closed',
        goal_reached: 'Goal reached — thank you!',
        reconciliation_required: 'Confirming a payment…',
      }[reason],
    );
    await page.getByText('Details', { exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Contribution availability', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Refresh challenge', exact: true }).click();
    noCommands(state.requests);
  });
for (const provider of ['stripe', 'paypal'] as const)
  test(`synthetic ${provider} receipt never turns return or pending approval into verified money`, async ({
    page,
  }) => {
    const state = await fixture(page);
    state.receipt = privateReceiptFixture(provider);
    await open(
      page,
      'view=return&checkout=' +
        ids.checkout +
        '&token=synthetic-secret&PayerID=synthetic-secret&status=success',
    );
    await expect(page).toHaveURL('http://127.0.0.1:4175/receipts/' + ids.checkout);
    await expect(
      page.getByRole('heading', { name: 'Confirming a payment…', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('90071992547409.93 EUR', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Payment confirmed', exact: true })).toHaveCount(
      0,
    );
    await page.getByText('Receipt details', { exact: true }).click();
    await page.getByRole('button', { name: 'Refresh receipt', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Confirming a payment…', exact: true }),
    ).toBeVisible();
    noCommands(state.requests);
    expect(
      await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
    ).toEqual({ local: 0, session: 0 });
  });
test('synthetic receipt shows canonical verified, late and unclassified timing without a refund promise', async ({
  page,
}, info) => {
  const state = await fixture(page);
  state.receipt.data.state = 'succeeded';
  state.receipt.data.payments = [
    {
      id: ids.payment,
      amountMinor: '1007',
      paidAt: null,
      eligibilityReferenceAt: state.receipt.serverTime,
      eligibilityTimeBasis: 'stripe_success_event',
      eligibility: 'late',
    },
    {
      id: ids.other,
      amountMinor: '1001',
      paidAt: null,
      eligibilityReferenceAt: null,
      eligibilityTimeBasis: 'unknown',
      eligibility: 'unclassified',
    },
  ];
  await open(page, 'view=receipt&checkout=' + ids.checkout);
  await expect(page.getByRole('heading', { name: 'Payment confirmed', exact: true })).toBeVisible();
  await expect(page.getByText(/Stripe success-event reference/)).toBeHidden();
  await page.getByText('Receipt details', { exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Received outside the funding deadline', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Payment received, confirming funding eligibility…',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/Stripe success-event reference/)).toBeVisible();
  await expect(page.getByText('Not supplied', { exact: true })).toHaveCount(0);
  noCommands(state.requests);
  await capture(page, 'receipt', info.project.name);
});
test('synthetic receipt automatically confirms eligible money without a client command', async ({
  page,
}) => {
  const state = await fixture(page);
  await open(page, 'view=receipt&checkout=' + ids.checkout);
  await expect(
    page.getByRole('heading', { name: 'Confirming a payment…', exact: true }),
  ).toBeVisible();
  state.receipt.data.state = 'succeeded';
  state.receipt.data.payments = [
    {
      id: ids.payment,
      amountMinor: '1007',
      paidAt: state.receipt.serverTime,
      eligibilityReferenceAt: state.receipt.serverTime,
      eligibilityTimeBasis: 'provider_success_time',
      eligibility: 'eligible',
    },
  ];
  await expect(page.getByRole('heading', { name: 'Payment confirmed', exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByText('Receipt details', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Deadline eligible', exact: true })).toBeVisible();
  noCommands(state.requests);
});
test('synthetic failed attempt is distinct from unconfirmed outcome', async ({ page }) => {
  const state = await fixture(page);
  state.receipt.data.state = 'failed';
  await open(page, 'view=receipt&checkout=' + ids.checkout);
  await expect(page.getByRole('heading', { name: 'Checkout failed', exact: true })).toBeVisible();
  noCommands(state.requests);
});
test('synthetic expiry hides previously read private money on deliberate refresh', async ({
  page,
}) => {
  const state = await fixture(page);
  await open(page, 'view=receipt&checkout=' + ids.checkout);
  await expect(page.getByText('90071992547409.93 EUR', { exact: true })).toBeVisible();
  state.receiptStatus = 401;
  await page.getByText('Receipt details', { exact: true }).click();
  await page.getByRole('button', { name: 'Refresh receipt', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('unavailable in this browser');
  await expect(page.getByText('90071992547409.93 EUR', { exact: true })).toHaveCount(0);
  await expect(page.getByText('private raw text must not render')).toHaveCount(0);
  noCommands(state.requests);
});
test('synthetic invalid return needs lookup and validates reference before a private read', async ({
  page,
}) => {
  const state = await fixture(page);
  await open(page, 'view=return&checkout=invalid&status=success&token=synthetic-secret');
  await expect(page).toHaveURL('http://127.0.0.1:4175/receipts');
  await expect(
    page.getByRole('heading', { name: 'Find a private receipt', exact: true }),
  ).toBeVisible();
  expect(state.requests).toHaveLength(0);
  await page.getByRole('textbox', { name: 'Checkout reference', exact: true }).fill('not-an-id');
  await page.getByRole('button', { name: 'Open private receipt', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter a valid checkout reference.');
  expect(state.requests).toHaveLength(0);
  await page.getByRole('textbox', { name: 'Checkout reference', exact: true }).fill(ids.checkout);
  await page.getByRole('button', { name: 'Open private receipt', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Confirming a payment…', exact: true }),
  ).toBeVisible();
  noCommands(state.requests);
});
test('synthetic public and receipt views support 320px, keyboard, reduced motion and axe', async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'view=public&publicId=' + ids.public);
  await expect(page.getByRole('progressbar')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await open(page, 'view=receipt&checkout=' + ids.checkout);
  await expect(
    page.getByRole('heading', { name: 'Confirming a payment…', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByText('Receipt details', { exact: true }).click();
  await page.getByRole('button', { name: 'Refresh receipt', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Refresh receipt', exact: true })).toBeFocused();
});
test('offline product route has no fake guest login or test-only fixture entry', async ({
  page,
}) => {
  await page.goto('/contribute/' + ids.public);
  await expect(
    page.getByRole('heading', { name: 'Contribution service not connected', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('SYNTHETIC READ FIXTURE', { exact: false })).toHaveCount(0);
});
test('synthetic invalid public references make no request and public not-found never requests a guest cookie', async ({
  page,
}) => {
  const state = await fixture(page);
  await open(page, 'view=public&publicId=invalid');
  await expect(page.getByRole('alert')).toContainText('Check the challenge or receipt reference');
  expect(state.requests).toHaveLength(0);
  await open(page, 'view=public&publicId=' + ids.other);
  await expect(page.getByRole('alert')).toHaveText(
    'This challenge is unavailable. Check its public link or refresh to check again.',
  );
  noCommands(state.requests);
});
test('synthetic long public content and exact large amounts reflow without dropping accepted terms', async ({
  page,
}) => {
  const state = await fixture(page);
  state.public.data.terms.text = 'Community idea ' + 'very-long-viewer-word'.repeat(90);
  state.public.data.terms.goal.amountMinor = '9007199254740993';
  state.public.data.funding.eligibleGross = '9007199254740993';
  await page.setViewportSize({ width: 320, height: 740 });
  await open(page, 'view=public&publicId=' + ids.public);
  await expect(
    page.getByRole('heading', { name: state.public.data.terms.text, exact: true }),
  ).toBeVisible();
  await expect(page.locator('.contribution-raised')).toContainText('90071992547409.93 EUR');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  noCommands(state.requests);
});
