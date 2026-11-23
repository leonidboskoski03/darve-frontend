import { test, expect, type Page } from '@playwright/test';
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
  'access-control-allow-headers': 'content-type,idempotency-key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
async function setup(page: Page, provider: 'stripe' | 'paypal' = 'stripe') {
  const state = {
    public: publicContributionFixture(true),
    receipt: privateReceiptFixture(provider),
    commands: [] as { path: string; key: string | undefined; body: string | null }[],
    quotes: [] as { path: string; amount: string | null }[],
    mode: 'proof' as 'proof' | 'unknown' | 'stale' | 'okay' | 'needs_approval',
    captured: false,
    embeddedPaid: false,
    embeddedRejected: false,
    quick: 'confirmed' as 'confirmed' | 'declined',
  };
  state.receipt.data.amount.amountMinor = '1000';
  await page.route('http://127.0.0.1:3310/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const error = (code: string, status: number) =>
      reply(
        {
          schemaVersion: 1,
          serverTime: '2026-11-02T12:00:00.000Z',
          error: {
            code,
            message: 'private raw provider text',
            requestId: 'synthetic-checkout',
            retryAfterSeconds: null,
            retryable: true,
            issues: [],
            refetch: null,
          },
        },
        status,
      );
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (request.method() === 'GET' && path.endsWith('/paypal-quick/quote')) {
      state.quotes.push({ path, amount: new URL(request.url()).searchParams.get('amountMinor') });
      await reply({
        clientId: 'synthetic-paypal-client',
        merchantId: 'SELLER0000001',
        attributionId: 'Synthetic_BN',
        agreementId: ids.other,
        currency: 'EUR',
        feeMinor: '70',
      });
      return;
    }
    if (request.method() === 'GET' && path.endsWith('/stripe-embedded/quote')) {
      state.quotes.push({ path, amount: new URL(request.url()).searchParams.get('amountMinor') });
      await reply({
        publishableKey: 'pk_test_syntheticembeddedfixture',
        connectedAccountId: 'acct_syntheticembedded',
        agreementId: ids.other,
        currency: 'EUR',
        feeMinor: '70',
      });
      return;
    }
    if (request.method() === 'GET' && path === '/api/stripe-embedded/checkouts/' + ids.checkout) {
      const value = structuredClone(state.receipt);
      value.data.state = state.embeddedPaid ? 'succeeded' : 'awaiting';
      value.data.nextAction = null;
      value.data.payments = state.embeddedPaid
        ? [
            {
              id: ids.payment,
              amountMinor: '1000',
              paidAt: null,
              eligibilityReferenceAt: null,
              eligibilityTimeBasis: 'unknown',
              eligibility: 'unclassified',
            },
          ]
        : [];
      await reply(value);
      return;
    }
    if (request.method() === 'POST') {
      state.commands.push({
        path,
        key: request.headers()['idempotency-key'],
        body: request.postData(),
      });
      if (path.endsWith('/stripe-embedded/sessions')) {
        if (state.embeddedRejected) {
          await error('EMBEDDED_SESSION_NOT_OPENED', 409);
        } else if (state.mode === 'proof') {
          state.mode = 'okay';
          await error('GUEST_PROOF_REQUIRED', 409);
        } else
          await reply(
            {
              checkoutId: ids.checkout,
              mount: {
                connectedAccountId: 'acct_syntheticembedded',
                clientSecret: 'cs_test_embedded_secret_fixture',
              },
            },
            201,
          );
      } else if (path.endsWith('/paypal-quick/orders')) {
        if (state.mode === 'proof') {
          state.mode = 'okay';
          await error('GUEST_PROOF_REQUIRED', 409);
        } else await reply({ orderId: 'QUICKORDER' }, 201);
      } else if (path === '/api/paypal-quick/orders/QUICKORDER/complete') {
        if (state.quick === 'declined') await error('PAYPAL_DECLINED', 422);
        else {
          const value = structuredClone(state.receipt);
          value.data.state = 'succeeded';
          value.data.payments = [
            {
              id: ids.payment,
              amountMinor: '1000',
              paidAt: null,
              eligibilityReferenceAt: null,
              eligibilityTimeBasis: 'unknown',
              eligibility: 'unclassified',
            },
          ];
          await reply(value);
        }
      } else if (path.endsWith('/checkouts')) {
        if (state.mode === 'proof') {
          state.mode = 'okay';
          await error('GUEST_PROOF_REQUIRED', 409);
        } else if (state.mode === 'unknown') {
          state.mode = 'okay';
          await route.abort('failed');
        } else if (state.mode === 'stale') await error('STALE_VERSION', 409);
        else await reply(state.receipt, 201);
      } else if (path.endsWith('/resume')) {
        const value = structuredClone(state.receipt);
        value.data.nextAction =
          provider === 'stripe'
            ? {
                type: 'redirect',
                url: 'https://checkout.stripe.com/c/pay/cs_test_SYNTHETIC#synthetic-stripe-configuration',
              }
            : {
                type: 'paypal_approval',
                orderId: 'SYNTHETICORDER',
                url: 'https://www.sandbox.paypal.com/checkoutnow?token=SYNTHETICORDER',
              };
        value.data.state = 'awaiting';
        await reply(value);
      } else if (path.endsWith('/complete')) {
        state.captured = state.mode !== 'needs_approval';
        state.receipt.data.state = state.mode === 'needs_approval' ? 'awaiting' : 'unknown';
        await reply(state.receipt, 202);
      } else await error('NOT_FOUND', 404);
    } else if (path === '/api/public/challenges/' + ids.public) await reply(state.public);
    else if (path === '/api/checkouts/' + ids.checkout) await reply(state.receipt);
    else await error('NOT_FOUND', 404);
  });
  return state;
}
test('amount picks and custom input feed both primary methods above the alternate checkout', async ({
  page,
}) => {
  const state = await setup(page);
  await quickSdk(page, 'approve');
  await page.goto(base + '?view=public&publicId=' + ids.public, { waitUntil: 'domcontentloaded' });
  const picker = page.getByRole('group', { name: 'Contribution amount (EUR)' });
  const paypal = page.getByRole('region', { name: 'Quick Pay' });
  const stripe = page.getByRole('region', { name: /Pay on this page/ });
  await picker.getByRole('button', { name: '5', exact: true }).click();
  await expect(
    page.getByText('Includes 0.70 EUR Darve fee · Details', { exact: true }),
  ).toBeVisible();
  await paypal.getByRole('checkbox').check();
  await stripe.getByRole('checkbox').check();
  await expect(paypal.getByRole('button', { name: 'PayPal wallet' })).toBeVisible();
  await expect(paypal.getByRole('button', { name: 'PayPal card' })).toBeVisible();
  await expect(stripe.getByRole('button', { name: 'Open card form' })).toBeEnabled();
  await picker.getByLabel('Custom amount (EUR)').fill('7.50');
  await expect(paypal.getByRole('checkbox')).not.toBeChecked();
  await expect(stripe.getByRole('checkbox')).not.toBeChecked();
  await expect
    .poll(() =>
      state.quotes.map(({ path, amount }) => path.split('/').at(-2) + ':' + amount).sort(),
    )
    .toEqual([
      'paypal-quick:500',
      'paypal-quick:750',
      'stripe-embedded:500',
      'stripe-embedded:750',
    ]);
  await expect(page.getByRole('heading', { name: 'Other ways to pay' })).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Payment method' }).getByRole('option'),
  ).toHaveText(['Choose a method', 'Stripe', 'PayPal']);
  expect(state.commands).toHaveLength(0);
});
test('M3-2 embedded Stripe allows retry when the form could not open', async ({ page }) => {
  const state = await setup(page);
  state.embeddedRejected = true;
  await page.goto(base + '?view=public&publicId=' + ids.public, { waitUntil: 'domcontentloaded' });
  const section = page.getByRole('region', {
    name: 'Pay on this page (card / Apple Pay / Google Pay)',
  });
  await page.getByLabel('Custom amount (EUR)').fill('10.00');
  await section.getByRole('checkbox').check();
  const start = section.getByRole('button', { name: 'Open card form' });
  await start.click();
  await expect(section.getByRole('alert')).toHaveText(
    'Couldn’t open the card form. Nothing was charged. Try again.',
  );
  await expect(section.getByText('Confirming a payment…')).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Check this payment' })).toHaveCount(0);
  await expect(start).toBeEnabled();
  await start.click();
  await expect.poll(() => state.commands.length).toBe(2);
  expect(state.commands[0]?.key).not.toBe(state.commands[1]?.key);
  expect(state.commands[0]?.body).toBe(state.commands[1]?.body);
});
test('M3-2 embedded Stripe waits for verified status', async ({ page }) => {
  const state = await setup(page);
  await page.route('https://js.stripe.com/endive/stripe.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        window.Stripe = (key, options) => ({
          async createEmbeddedCheckoutPage({ fetchClientSecret, onComplete }) {
            if (key !== 'pk_test_syntheticembeddedfixture' ||
                options.stripeAccount !== 'acct_syntheticembedded' ||
                await fetchClientSecret() !== 'cs_test_embedded_secret_fixture') throw new Error('Bad mount');
            const button = document.createElement('button');
            button.textContent = 'Pay with test card';
            button.onclick = onComplete;
            return { mount: (target) => target.append(button), destroy: () => button.remove() };
          }
        });
      `,
    }),
  );
  await page.goto(base + '?view=public&publicId=' + ids.public, {
    waitUntil: 'domcontentloaded',
  });
  const section = page.getByRole('region', {
    name: 'Pay on this page (card / Apple Pay / Google Pay)',
  });
  await page.getByLabel('Custom amount (EUR)').fill('10.00');
  await expect(section.getByRole('button', { name: 'Open card form' })).toBeDisabled();
  await section.getByRole('checkbox').check();
  await section.getByRole('button', { name: 'Open card form' }).click();
  await section.getByRole('button', { name: 'Pay with test card' }).click();
  await expect(section.getByText('Confirming a payment…')).toBeVisible();
  await expect(section.getByRole('link', { name: 'View receipt' })).toHaveCount(0);
  state.embeddedPaid = true;
  await section.getByRole('button', { name: 'Check this payment' }).click();
  await expect(section.getByText('Payment confirmed')).toBeVisible();
  await expect(section.getByRole('link', { name: 'View receipt' })).toHaveAttribute(
    'href',
    '/receipts/' + ids.checkout,
  );
  expect(state.commands).toHaveLength(2);
  expect(state.commands[0]).toEqual(state.commands[1]);
  await expect(page.getByRole('heading', { name: 'Quick Pay' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare checkout' })).toBeVisible();
});
async function quickSdk(page: Page, mode: 'approve' | 'cancel' | 'load-fails') {
  await page.route(/^https:\/\/www\.sandbox\.paypal\.com\/sdk\/js\?/, async (route) => {
    if (mode === 'load-fails') return route.abort();
    await route.fulfill({
      contentType: 'application/javascript',
      body: `
window[document.currentScript.dataset.namespace] = {
  FUNDING: { PAYPAL: 'paypal', CARD: 'card' },
  Buttons(options) {
    let button;
    return {
      isEligible: () => true,
      close: async () => button?.remove(),
      render: async (element) => {
        button = document.createElement('button');
        button.textContent = options.fundingSource === 'card' ? 'PayPal card' : 'PayPal wallet';
        button.onclick = async () => {
          try {
            const orderID = await options.createOrder();
            if (${JSON.stringify(mode)} === 'approve') await options.onApprove({ orderID });
            else options.onCancel();
          } catch { options.onError(); }
        };
        element.append(button);
      }
    };
  }
};`,
    });
  });
}
async function reviewQuick(page: Page) {
  await page.goto(base + '?view=public&publicId=' + ids.public, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Custom amount (EUR)').fill('10.00');
  await page
    .getByRole('checkbox', {
      name: /accept the challenge terms and PayPal contribution fee of 0.70 EUR/,
    })
    .check();
}
test('M3-1 Quick Pay confirms a card contribution and links to the private receipt', async ({
  page,
}) => {
  const state = await setup(page, 'paypal');
  await quickSdk(page, 'approve');
  await reviewQuick(page);
  await page.getByRole('button', { name: 'PayPal card' }).click();
  await expect(page.getByText('Payment confirmed', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View receipt', exact: true })).toHaveAttribute(
    'href',
    '/receipts/' + ids.checkout,
  );
  const orders = state.commands.filter((command) => command.path.endsWith('/paypal-quick/orders'));
  expect(orders).toHaveLength(2);
  expect(orders[0]).toEqual(orders[1]);
  expect(
    state.commands.filter((command) => command.path.endsWith('/QUICKORDER/complete')),
  ).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Prepare checkout' })).toBeVisible();
});
test('M3-1 closing the PayPal popup never sends capture', async ({ page }) => {
  const state = await setup(page, 'paypal');
  await quickSdk(page, 'cancel');
  await reviewQuick(page);
  await page.getByRole('button', { name: 'PayPal wallet' }).click();
  await expect(page.getByText('PayPal was closed.', { exact: false })).toBeVisible();
  expect(state.commands.some((command) => command.path.endsWith('/complete'))).toBe(false);
});
test('M3-1 Quick Pay shows a clear capture failure', async ({ page }) => {
  const state = await setup(page, 'paypal');
  state.quick = 'declined';
  await quickSdk(page, 'approve');
  await reviewQuick(page);
  await page.getByRole('button', { name: 'PayPal wallet' }).click();
  await expect(page.getByText('PayPal declined this payment.', { exact: true })).toBeVisible();
  await expect(page.getByText('Payment confirmed', { exact: true })).toHaveCount(0);
});
test('M3-1 SDK load failure retains the standard PayPal and Stripe methods', async ({ page }) => {
  const state = await setup(page, 'paypal');
  state.mode = 'okay';
  await quickSdk(page, 'load-fails');
  await reviewQuick(page);
  await expect(page.getByText('Quick Pay could not open.', { exact: false })).toBeVisible();
  const method = page.getByRole('combobox', { name: 'Payment method' });
  await expect(method.locator('option[value="stripe"]')).toHaveText('Stripe');
  await method.selectOption('paypal');
  await page.getByRole('checkbox', { name: /I reviewed this challenge/ }).check();
  await page.getByRole('button', { name: 'Prepare checkout', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Private contribution receipt', exact: true }),
  ).toBeVisible();
  expect(state.commands.some((command) => command.path.endsWith('/checkouts'))).toBe(true);
});
async function prepare(page: Page, provider = 'stripe') {
  await page.goto(base + '?view=public&publicId=' + ids.public, { waitUntil: 'domcontentloaded' });
  await page.getByRole('combobox', { name: 'Payment method', exact: true }).selectOption(provider);
  await page.getByRole('checkbox', { name: /I reviewed this challenge/ }).check();
  await page.getByRole('button', { name: 'Prepare checkout', exact: true }).click();
}
test('synthetic cookie handshake preserves reviewed request and opens canonical receipt without provider navigation', async ({
  page,
}) => {
  const state = await setup(page);
  await prepare(page);
  await expect(page.getByRole('alert')).toContainText('initialized');
  await page.getByRole('button', { name: 'Continue same contribution', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Private contribution receipt', exact: true }),
  ).toBeVisible();
  expect(state.commands).toHaveLength(2);
  expect(state.commands[0]).toEqual(state.commands[1]);
  expect(JSON.parse(state.commands[0].body!)).toMatchObject({
    amountMinor: '1000',
    paymentProvider: 'stripe',
    termsVersion: ids.terms,
  });
  await expect(page).toHaveURL(/\/receipts\//);
  await expect(
    page.getByRole('button', { name: 'Continue to Stripe', exact: true }),
  ).toBeDisabled();
});
test('synthetic unknown creation keeps the same intent and exposes no replacement action', async ({
  page,
}) => {
  const state = await setup(page);
  state.mode = 'unknown';
  await prepare(page);
  await expect(page.getByRole('alert')).toContainText('unconfirmed');
  await expect(page.getByRole('button', { name: 'Review contribution again' })).toHaveCount(0);
  await expect(page.getByLabel('Amount (EUR)', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry same preparation', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Private contribution receipt', exact: true }),
  ).toBeVisible();
  expect(state.commands[0]).toEqual(state.commands[1]);
});
test('synthetic unknown PayPal preparation can retry the same private receipt', async ({
  page,
}) => {
  const state = await setup(page, 'paypal');
  state.receipt.data.state = 'unknown';
  await page.route('https://www.sandbox.paypal.com/**', (route) =>
    route.fulfill({ body: 'Synthetic PayPal approval' }),
  );
  await page.goto(base + '?view=receipt&checkout=' + ids.checkout);
  const retry = page.getByRole('button', { name: 'Retry PayPal preparation' });
  await expect(retry).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Complete PayPal payment' })).toHaveCount(0);
  expect(state.commands).toHaveLength(0);
  await page.getByRole('checkbox', { name: /retry the same PayPal preparation/ }).check();
  await retry.click();
  await expect(page.getByText('Synthetic PayPal approval')).toBeVisible();
  expect(state.commands).toEqual([
    { path: '/api/checkouts/' + ids.checkout + '/resume', body: '{}', key: undefined },
  ]);
});
test('synthetic stale terms require a new unchecked review rather than an automatic retry', async ({
  page,
}) => {
  const state = await setup(page);
  state.mode = 'stale';
  await prepare(page);
  await expect(page.getByRole('alert')).toContainText('changed');
  expect(state.commands).toHaveLength(1);
  await page.getByRole('button', { name: 'Review contribution again', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /I reviewed this challenge/ })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Prepare checkout', exact: true })).toBeDisabled();
});
for (const provider of ['stripe', 'paypal'] as const)
  test(`synthetic ${provider} continuation follows only an explicit reviewed private-receipt action`, async ({
    page,
  }) => {
    const state = await setup(page, provider);
    await page.route(
      provider === 'stripe'
        ? 'https://checkout.stripe.com/**'
        : 'https://www.sandbox.paypal.com/**',
      (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<h1>Synthetic provider destination</h1>',
        }),
    );
    await page.goto(base + '?view=receipt&checkout=' + ids.checkout, {
      waitUntil: 'domcontentloaded',
    });
    const name = 'Continue to ' + (provider === 'stripe' ? 'Stripe' : 'PayPal');
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    expect(state.commands).toHaveLength(0);
    await page.getByRole('checkbox', { name: /I reviewed this checkout/ }).check();
    await page.getByRole('button', { name, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Synthetic provider destination' }),
    ).toBeVisible();
    expect(state.commands.map((row) => row.path)).toEqual([
      '/api/checkouts/' + ids.checkout + '/resume',
    ]);
    expect(state.captured).toBe(false);
  });
test('synthetic PayPal return never captures automatically and explicit completion remains unconfirmed on 202', async ({
  page,
}) => {
  const state = await setup(page, 'paypal');
  await page.goto(
    base + '?view=return&checkout=' + ids.checkout + '&token=untrusted&status=success',
    { waitUntil: 'domcontentloaded' },
  );
  await expect(
    page.getByRole('button', { name: 'Complete PayPal payment', exact: true }),
  ).toBeDisabled();
  expect(state.commands).toHaveLength(0);
  await expect(page).toHaveURL(/\/receipts\/[^?]+$/);
  await page.getByRole('checkbox', { name: /I approved this order on PayPal/ }).check();
  await page.getByRole('button', { name: 'Complete PayPal payment', exact: true }).click();
  await page.getByText('Receipt details', { exact: true }).click();
  await expect(page.getByText('Outcome unknown', { exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(1);
  expect(state.commands[0]?.path).toMatch(/\/complete$/);
  expect(state.commands[0]?.body).toBe('{}');
  expect(state.commands[0]?.key).toBeTruthy();
});
test('synthetic unapproved PayPal completion keeps continuation of the original order available', async ({
  page,
}) => {
  const state = await setup(page, 'paypal');
  state.mode = 'needs_approval';
  await page.route('https://www.sandbox.paypal.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Synthetic original PayPal approval</h1>',
    }),
  );
  await page.goto(base + '?view=receipt&checkout=' + ids.checkout, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('checkbox', { name: /I approved this order on PayPal/ }).check();
  await page.getByRole('button', { name: 'Complete PayPal payment', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Payment is not confirmed' }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: /I reviewed this checkout/ }).check();
  await page.getByRole('button', { name: 'Continue to PayPal', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Synthetic original PayPal approval' }),
  ).toBeVisible();
  expect(state.captured).toBe(false);
  expect(state.commands.map((row) => row.path)).toEqual([
    '/api/checkouts/' + ids.checkout + '/complete',
    '/api/checkouts/' + ids.checkout + '/resume',
  ]);
});
test('synthetic checkout form supports keyboard, reduced motion, 320px reflow and accessibility', async ({
  page,
}, info) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base + '?view=public&publicId=' + ids.public, { waitUntil: 'domcontentloaded' });
  const select = page.getByRole('combobox', { name: 'Payment method', exact: true });
  await expect(select).toBeVisible();
  if (process.env.F06_CAPTURE_DIR) {
    await mkdir(process.env.F06_CAPTURE_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.F06_CAPTURE_DIR, 'checkout-' + info.project.name + '.png'),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await select.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox', { name: /I reviewed this challenge/ })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
