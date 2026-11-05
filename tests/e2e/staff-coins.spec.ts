import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  ids,
  envelope,
  problem,
  session,
  configuration,
  account,
  item,
} from '../../src/services/staff-coins/fixture.test-helper';
const base = 'http://127.0.0.1:4175/tests/fixtures/staff-coins.html';
async function scenario(page: Page, owner = true) {
  const state = {
    configuration: configuration(),
    account: account(),
    item: item(),
    writes: [] as { path: string; key: string | null; body: Record<string, unknown> }[],
    mode: 'ok' as 'ok' | 'stale' | 'lost',
    expired: false,
    reads: [] as string[],
  };
  await page.route('http://127.0.0.1:3320/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    const send = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        headers: {
          'content-type': 'application/json',
          'Access-Control-Allow-Origin': 'http://127.0.0.1:4175',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': 'Content-Type,X-Staff-CSRF,Idempotency-Key',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        },
        body: JSON.stringify(body),
      });
    if (request.method() === 'OPTIONS') return send({});
    if (path === '/admin/v1/session') return send(envelope(session(owner)));
    if (path === '/admin/v1/auth/email-code') return send(problem('UNAUTHENTICATED'), 401);
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.writes.push({ path, key: request.headers()['idempotency-key'] ?? null, body });
      if (state.mode === 'stale') {
        state.mode = 'ok';
        state.configuration.revision++;
        state.configuration.configurations[0].revision = state.configuration.revision;
        return send(problem('STALE_VERSION'), 409);
      }
      if (path.endsWith('/configuration-revisions')) {
        state.configuration = {
          ...state.configuration,
          revision: 2,
          configurations: [
            {
              ...state.configuration.configurations[0],
              revision: 2,
              active: Boolean(body.active),
              rewards: body.rewards as (typeof state.configuration.configurations)[0]['rewards'],
            },
          ],
        };
        if (state.mode === 'lost') {
          state.mode = 'ok';
          return route.abort('failed');
        }
        return send({ schemaVersion: 1, data: { revision: 2, state: 'configured' } });
      }
      if (path.endsWith('/adjustments'))
        return send({
          schemaVersion: 1,
          data: { revision: 2, state: 'synchronization_pending', transactionId: ids.ticket },
        });
      if (path.endsWith('/prices')) {
        state.item = { ...state.item, amount: String(body.amount), priceRevision: 2 };
        return send(
          envelope({ templateId: state.item.id, revision: 2, amount: state.item.amount }),
        );
      }
      return send(problem('FORBIDDEN'), 403);
    }
    state.reads.push(path);
    if (path === '/admin/v1/coins/configuration') return send(state.configuration);
    if (path === '/admin/v1/coins/accounts/' + ids.creator) return send(state.account);
    if (path === '/admin/v1/coins/templates') return send(envelope({ templates: [state.item] }));
    if (path.endsWith('/configuration-history'))
      return send(envelope({ items: state.configuration.configurations, nextCursor: null }));
    if (path.endsWith('/ledger')) {
      if (url.searchParams.has('cursor') && state.expired)
        return send(problem('INVALID_INPUT'), 400);
      return send(
        envelope({
          items: [
            {
              id: ids.ticket,
              revision: 1,
              delta: '9007199254740993',
              balance: state.account.balance,
              kind: 'adjustment',
              createdAt: '2026-11-05T00:00:00.000Z',
            },
          ],
          nextCursor: url.searchParams.has('cursor') ? null : 'opaque-synthetic-next',
        }),
      );
    }
    if (path.endsWith('/prices'))
      return send(
        envelope({
          items: [{ revision: 1, amount: '10', createdAt: '2026-11-05T00:00:00.000Z' }],
          nextCursor: null,
        }),
      );
    return send(problem('NOT_FOUND'), 404);
  });
  return state;
}
async function reviewConfiguration(page: Page) {
  await page.getByLabel('Reward configuration reason').fill('Reviewed synthetic future rewards');
  await page.getByRole('button', { name: 'Review reward configuration', exact: true }).click();
}
async function confirm(page: Page) {
  await page
    .getByRole('checkbox', { name: 'I reviewed this exact target, values, reason and revision.' })
    .check();
  await page.getByRole('button', { name: 'Confirm coin change', exact: true }).click();
}
test('owner reviews exact future rewards and requires separate unchecked confirmation', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(base);
  await expect(
    page.getByRole('heading', { name: 'Coin administration', exact: true }),
  ).toBeVisible();
  await page.getByLabel('10 qualifying suggestions reward').fill('11');
  await reviewConfiguration(page);
  await expect(
    page.getByRole('button', { name: 'Confirm coin change', exact: true }),
  ).toBeDisabled();
  expect(state.writes).toHaveLength(0);
  await expect(page.getByText(/10 qualifying suggestions: 11 coins/)).toBeVisible();
  await confirm(page);
  await expect(page.locator('.staff-coins-command').getByRole('status')).toContainText(
    'server recorded',
  );
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]?.body).toMatchObject({
    expectedRevision: 1,
    rewards: { 'suggestions.10': '11' },
  });
});
test('cancelled review sends no request and permits a new explicit review', async ({ page }) => {
  const state = await scenario(page);
  await page.goto(base);
  await reviewConfiguration(page);
  await page.getByRole('button', { name: 'Cancel coin review' }).click();
  await expect(page.getByRole('heading', { name: 'Review coin change' })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});
test('lost configuration acknowledgement keeps same key and body across explicit retry', async ({
  page,
}) => {
  const state = await scenario(page);
  state.mode = 'lost';
  await page.goto(base);
  await reviewConfiguration(page);
  await confirm(page);
  await expect(page.locator('.staff-coins-command').getByRole('alert')).toContainText(
    'Result unconfirmed',
  );
  await expect(page.getByRole('button', { name: 'Creator account', exact: true })).toBeDisabled();
  await page
    .getByRole('checkbox', { name: 'I reviewed this exact target, values, reason and revision.' })
    .check();
  await page.getByRole('button', { name: 'Retry same coin change' }).click();
  await expect(page.locator('.staff-coins-command').getByRole('status')).toContainText(
    'server recorded',
  );
  expect(state.writes).toHaveLength(2);
  expect(state.writes[0]).toEqual(state.writes[1]);
});
test('stale configuration rejects old review and requires fresh values and confirmation', async ({
  page,
}) => {
  const state = await scenario(page);
  state.mode = 'stale';
  await page.goto(base);
  await reviewConfiguration(page);
  await confirm(page);
  await expect(page.locator('.staff-coins-command').getByRole('status')).toContainText(
    'reviewed version',
  );
  await expect(page.getByRole('heading', { name: 'Review coin change' })).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  await reviewConfiguration(page);
  await expect(
    page.getByRole('button', { name: 'Confirm coin change', exact: true }),
  ).toBeDisabled();
  await expect(page.getByText('Reviewed revision: 2')).toBeVisible();
});
test('account adjustment retains exact large balance and acknowledges pending synchronization', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(base + '?view=account&owner=' + ids.creator);
  await expect(
    page.getByText('9,007,199,254,740,993 coins', { exact: true }).first(),
  ).toBeVisible();
  await page.getByLabel('Adjustment direction').selectOption('debit');
  await page.getByLabel('Adjustment coins').fill('10');
  await page.getByLabel('Balance adjustment reason').fill('Reviewed synthetic correction');
  await page.getByRole('button', { name: 'Review balance adjustment', exact: true }).click();
  await confirm(page);
  await expect(page.locator('.staff-coins-command').getByRole('status')).toContainText(
    'Synchronization is pending',
  );
  expect(state.writes[0]?.body).toMatchObject({
    direction: 'debit',
    amount: '10',
    confirmation: { ownerId: ids.creator, balance: '9007199254740993' },
  });
  await expect(
    page.getByText('9,007,199,254,740,993 coins', { exact: true }).first(),
  ).toBeVisible();
});
test('expired account cursor hides old page and supports explicit first-page recovery', async ({
  page,
}) => {
  const state = await scenario(page);
  state.expired = true;
  await page.goto(base + '?view=account&owner=' + ids.creator);
  await page.getByRole('button', { name: 'Next history page' }).click();
  await expect(page.getByRole('alert')).toContainText('cursor may have expired');
  await expect(page.getByRole('heading', { name: 'Recorded history' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reload first history page', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recorded history' })).toBeVisible();
});
test('template price supports explicit zero and renders external text literally', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(base + '?view=prices&template=synthetic_template');
  await expect(page.getByLabel('Template to inspect')).toHaveValue('synthetic_template');
  await expect(
    page.getByRole('option', { name: '<script>Literal template</script> (synthetic_template)' }),
  ).toHaveText('<script>Literal template</script> (synthetic_template)');
  expect(await page.locator('script:not([src])').count()).toBe(0);
  await page.getByLabel('New template price in coins').fill('0');
  await page.getByLabel('Template price reason').fill('Reviewed synthetic free price');
  await page.getByRole('button', { name: 'Review template price', exact: true }).click();
  await confirm(page);
  expect(state.writes[0]?.body).toMatchObject({
    expectedRevision: 1,
    amount: '0',
    confirmation: { templateId: 'synthetic_template' },
  });
  await expect(page.getByText('Current price: 0 coins · Price revision: 2')).toBeVisible();
});
test('Support direct navigation cannot load owner coin records or commands', async ({ page }) => {
  const state = await scenario(page, false);
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Coin tools unavailable' })).toBeVisible();
  expect(state.reads).toHaveLength(0);
  expect(state.writes).toHaveLength(0);
});
test('coin tools support keyboard, reduced motion, 320px reflow and sampled accessibility', async ({
  page,
}) => {
  await scenario(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(base);
  await page.getByLabel('Reward configuration reason').fill('Keyboard review');
  await page.getByRole('button', { name: 'Review reward configuration', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Review coin change' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'artifacts.local/f09-06/owner-mobile-synthetic-' + test.info().project.name + '.png',
    fullPage: true,
  });
});
