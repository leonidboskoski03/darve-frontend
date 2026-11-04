import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { CoinMissionSchema } from '../../src/services/contracts/index';
import { syntheticReportingSession } from '../../src/services/reporting/fixture.test-helper';
const stamp = '2026-11-04T12:00:00.000Z';
const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4175',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'X-CSRF-Token,Content-Type,Idempotency-Key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
const base = 'http://127.0.0.1:4175/tests/fixtures/creator.html?view=coins';
const envelope = (data: unknown) => ({ schemaVersion: 1, serverTime: stamp, data });
const error = (code: string) => ({
  schemaVersion: 1,
  serverTime: stamp,
  error: {
    code,
    message: 'private fixture diagnostic',
    requestId: 'synthetic-coins',
    retryable: false,
    retryAfterSeconds: null,
    issues: [],
    refetch: null,
  },
});
const row = (revision: number) => ({
  id: `0000000${revision}-1234-4234-8234-112233445566`,
  revision,
  delta: revision === 2 ? '10' : '20',
  balance: revision === 2 ? '30' : '20',
  kind: 'mission',
  createdAt: stamp,
});
async function scenario(page: Page) {
  const state = {
    account: {
      balance: '30',
      spendableBalance: '30' as string | null,
      revision: 2,
      state: 'synchronized',
      redemptionAllowed: true,
    },
    progress: 11,
    completed: true,
    unconfigured: false,
    accountFailure: false,
    backendOff: false,
    pageFailure: false,
    overlap: false,
    signedOut: false,
    reads: [] as string[],
    mutations: [] as string[],
  };
  const json = (route: Route, value: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: cors,
      body: JSON.stringify(value),
    });
  await page.route('http://127.0.0.1:3310/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (url.pathname === '/api/session/logout') {
      state.signedOut = true;
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (url.pathname === '/api/session') {
      await json(route, state.signedOut ? { authenticated: false } : syntheticReportingSession);
      return;
    }
    if (request.method() !== 'GET') state.mutations.push(url.pathname);
    state.reads.push(url.pathname + url.search);
    if (state.backendOff) {
      await json(route, error('NOT_FOUND'), 404);
      return;
    }
    if (url.pathname === '/api/coins/account') {
      await json(
        route,
        state.accountFailure ? error('SERVICE_UNAVAILABLE') : envelope(state.account),
        state.accountFailure ? 503 : 200,
      );
      return;
    }
    if (url.pathname === '/api/coins/missions') {
      const amounts = ['20', '0', '40', '10', '100', '1000'];
      await json(
        route,
        envelope({
          progress: state.progress,
          progressCap: 1000,
          missions: CoinMissionSchema.options.map((id, index) => {
            const completed = state.completed && (index === 0 || index === 3);
            return {
              id,
              completed,
              earned: completed ? amounts[index] : null,
              completedAt: completed ? stamp : null,
              currentReward: state.unconfigured ? null : amounts[index],
            };
          }),
        }),
      );
      return;
    }
    if (url.pathname === '/api/coins/ledger') {
      if (state.unconfigured) {
        await json(route, envelope({ items: [], nextCursor: null }));
        return;
      }
      if (url.searchParams.has('cursor')) {
        await json(
          route,
          state.pageFailure
            ? error('INVALID_INPUT')
            : envelope({ items: [row(state.overlap ? 2 : 1)], nextCursor: null }),
          state.pageFailure ? 400 : 200,
        );
        return;
      }
      await json(route, envelope({ items: [row(2)], nextCursor: 'private-opaque-page' }));
      return;
    }
    await json(route, error('NOT_FOUND'), 404);
  });
  return state;
}
test('shows six real-contract mission states and exact paginated history', async ({ page }) => {
  const state = await scenario(page);
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Coins', exact: true })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(6);
  await expect(page.getByText('Completed', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Current reward: 0 coins', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: '10 qualifying suggestions progress' }),
  ).toHaveAttribute('value', '10');
  await page.getByRole('button', { name: 'Load more history' }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(3);
  await expect(page.getByRole('table').getByText('+20', { exact: true })).toBeVisible();
  expect(state.reads.some((r) => r.includes('cursor=private-opaque-page'))).toBe(true);
  expect(page.url()).not.toContain('opaque');
  expect(state.mutations).toEqual([]);
});
test('unconfigured rewards, confirmed zero and empty history stay distinct', async ({ page }) => {
  const state = await scenario(page);
  state.unconfigured = true;
  state.completed = false;
  state.progress = 0;
  state.account = {
    balance: '0',
    spendableBalance: '0',
    revision: 0,
    state: 'unconfigured',
    redemptionAllowed: true,
  };
  await page.goto(base);
  await expect(page.getByText('Rewards not configured', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Your balance' }).getByRole('definition'),
  ).toHaveText(['0 coins', '0 coins']);
  await expect(page.getByText('Current reward: Not configured', { exact: true })).toHaveCount(6);
  await expect(page.getByRole('heading', { name: 'No coin activity yet' })).toBeVisible();
});
test('pending and unknown available coins never become an available zero', async ({ page }) => {
  const state = await scenario(page);
  state.account.state = 'synchronization_pending';
  state.account.spendableBalance = null;
  state.account.redemptionAllowed = false;
  await page.goto(base);
  await expect(page.getByText('Verification pending', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Your balance' }).getByRole('definition'),
  ).toHaveText(['30 coins', 'Unconfirmed']);
});
test('a backend with the coin feature off shows unavailable information without a wallet', async ({
  page,
}) => {
  const state = await scenario(page);
  state.backendOff = true;
  await page.goto(base);
  await expect(page.getByRole('alert')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Your balance' }).getByRole('alert')).toContainText(
    'unavailable on this server',
  );
  await expect(page.getByRole('definition')).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);
});
test('failed reads hide old amounts and a keyboard refresh recovers safely', async ({ page }) => {
  const state = await scenario(page);
  await page.goto(base);
  const balance = page.getByRole('region', { name: 'Your balance' }),
    refresh = page.getByRole('button', { name: 'Refresh coins', exact: true });
  await expect(balance.getByRole('definition')).toHaveCount(2);
  await expect(refresh).toBeEnabled();
  state.accountFailure = true;
  await refresh.focus();
  await page.keyboard.press('Enter');
  await expect(balance.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(balance.getByRole('definition')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('private fixture diagnostic');
  state.accountFailure = false;
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(balance.getByRole('definition')).toHaveCount(2);
});
test('an expired cursor clears the history view and reload starts from the first page', async ({
  page,
}) => {
  const state = await scenario(page);
  state.pageFailure = true;
  await page.goto(base);
  await page.getByRole('button', { name: 'Load more history' }).click();
  await expect(page.getByRole('alert')).toContainText('history link has expired or changed');
  await expect(page.getByRole('table')).toHaveCount(0);
  state.pageFailure = false;
  await page.getByRole('button', { name: 'Reload history' }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
  expect(state.reads.at(-1)).toBe('/api/coins/ledger');
});
test('overlapping pages fail verification instead of hiding a duplicate', async ({ page }) => {
  const state = await scenario(page);
  state.overlap = true;
  await page.goto(base);
  await page.getByRole('button', { name: 'Load more history' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be verified');
  await expect(page.getByRole('table')).toHaveCount(0);
});
test('large exact balances, reduced motion, mobile sizing and accessibility hold', async ({
  page,
}) => {
  const state = await scenario(page);
  state.account.balance = '9223372036854775807';
  state.account.spendableBalance = state.account.balance;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base);
  await expect(
    page.getByRole('region', { name: 'Your balance' }).getByRole('definition'),
  ).toHaveText(['9,223,372,036,854,775,807 coins', '9,223,372,036,854,775,807 coins']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('logout disposes coin work and no mutation controls are offered', async ({ page }) => {
  const state = await scenario(page);
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Your balance' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your balance' })).toHaveCount(0);
  expect(state.mutations).toEqual([]);
  await expect(page.getByRole('button', { name: /claim|redeem|buy/i })).toHaveCount(0);
});
