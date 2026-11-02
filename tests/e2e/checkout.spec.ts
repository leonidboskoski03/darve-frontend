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
    mode: 'proof' as 'proof' | 'unknown' | 'stale' | 'okay',
    captured: false,
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
    if (request.method() === 'POST') {
      state.commands.push({
        path,
        key: request.headers()['idempotency-key'],
        body: request.postData(),
      });
      if (path.endsWith('/checkouts')) {
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
            ? { type: 'redirect', url: 'https://checkout.stripe.com/c/pay/cs_test_SYNTHETIC' }
            : {
                type: 'paypal_approval',
                orderId: 'SYNTHETICORDER',
                url: 'https://www.sandbox.paypal.com/checkoutnow?token=SYNTHETICORDER',
              };
        await reply(value);
      } else if (path.endsWith('/complete')) {
        state.captured = true;
        state.receipt.data.state = 'unknown';
        await reply(state.receipt, 202);
      } else await error('NOT_FOUND', 404);
    } else if (path === '/api/public/challenges/' + ids.public) await reply(state.public);
    else if (path === '/api/checkouts/' + ids.checkout) await reply(state.receipt);
    else await error('NOT_FOUND', 404);
  });
  return state;
}
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
  await expect(page.getByText('Outcome unknown', { exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(1);
  expect(state.commands[0]?.path).toMatch(/\/complete$/);
  expect(state.commands[0]?.body).toBe('{}');
  expect(state.commands[0]?.key).toBeTruthy();
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
