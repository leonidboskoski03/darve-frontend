import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { syntheticTemplateSession } from '../../src/services/templates/fixture.test-helper';
import { CoinMissionSchema } from '../../src/services/contracts/index';
const stamp = '2026-11-04T12:00:00.000Z',
  base = 'http://127.0.0.1:4175/tests/fixtures/creator.html?view=templates';
const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4175',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'X-CSRF-Token,Content-Type,Idempotency-Key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
const envelope = (data: unknown) => ({ schemaVersion: 1, serverTime: stamp, data });
const problem = (code: string) => ({
  schemaVersion: 1,
  serverTime: stamp,
  error: {
    code,
    message: 'private fixture diagnostic',
    requestId: 'synthetic-template',
    retryable: false,
    retryAfterSeconds: null,
    issues: [],
    refetch: null,
  },
});
async function scenario(page: Page) {
  const state = {
    balance: '100' as string | null,
    revision: 1,
    allowed: true,
    price: '25' as string | null,
    priceRevision: 1 as number | null,
    available: true,
    owned: false,
    pending: false,
    signedOut: false,
    readError: false,
    mode: 'pending' as 'pending' | 'network' | 'price' | 'insufficient' | 'malformed',
    posts: [] as { key: string | undefined; body: string | null }[],
    name: 'Synthetic premium',
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
      path = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (path === '/api/session/logout') {
      state.signedOut = true;
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (path === '/api/session') {
      await json(route, state.signedOut ? { authenticated: false } : syntheticTemplateSession);
      return;
    }
    if (request.method() === 'POST') {
      state.posts.push({ key: request.headers()['idempotency-key'], body: request.postData() });
      if (state.mode === 'network') {
        await route.abort('failed');
        return;
      }
      if (state.mode === 'malformed') {
        await json(route, { wrong: 'untrusted' });
        return;
      }
      if (state.mode === 'price' || state.mode === 'insufficient') {
        if (state.mode === 'price') {
          state.price = '30';
          state.priceRevision = 2;
        } else state.balance = '2';
        await json(
          route,
          problem(state.mode === 'price' ? 'PRICE_CHANGED' : 'INSUFFICIENT_BALANCE'),
          409,
        );
        return;
      }
      state.owned = true;
      state.pending = true;
      state.balance = '75';
      state.revision = 2;
      await json(
        route,
        envelope({
          templateId: 'synthetic',
          state: 'synchronization_pending',
          charged: (JSON.parse(request.postData()!) as { amount: string }).amount,
          transactionId: '11223344-1234-4234-8234-112233445566',
          redemptionId: '22334455-1234-4234-8234-112233445566',
        }),
      );
      return;
    }
    if (state.readError) {
      await json(route, problem('SERVICE_UNAVAILABLE'), 503);
      return;
    }
    const premium = {
      id: 'synthetic',
      displayName: state.name,
      assetVersion: 1,
      priceRevision: state.priceRevision,
      amount: state.price,
      available: state.available,
      owned: state.owned,
      ownershipState: state.owned
        ? state.pending
          ? 'synchronization_pending'
          : 'owned'
        : 'not_owned',
    };
    const free = {
      id: 'standalone',
      displayName: 'Standalone',
      assetVersion: 1,
      priceRevision: 1,
      amount: '0',
      available: true,
      owned: true,
      ownershipState: 'owned',
    };
    if (path === '/api/coins/account') {
      await json(
        route,
        envelope({
          balance: state.balance ?? '100',
          spendableBalance: state.balance,
          revision: state.revision,
          state: state.pending ? 'synchronization_pending' : 'synchronized',
          redemptionAllowed: state.allowed,
        }),
      );
      return;
    }
    if (path === '/api/templates') {
      await json(route, envelope({ templates: [free, premium] }));
      return;
    }
    if (path === '/api/template-entitlements') {
      await json(route, envelope({ templates: state.owned ? [free, premium] : [free] }));
      return;
    }
    if (path === '/api/coins/missions') {
      await json(
        route,
        envelope({
          progress: 0,
          progressCap: 1000,
          missions: CoinMissionSchema.options.map((id) => ({
            id,
            completed: false,
            earned: null,
            completedAt: null,
            currentReward: null,
          })),
        }),
      );
      return;
    }
    if (path === '/api/coins/ledger') {
      await json(route, envelope({ items: [], nextCursor: null }));
      return;
    }
    throw Error('Unexpected synthetic request ' + path);
  });
  return state;
}
async function review(page: Page) {
  await page.getByRole('button', { name: 'Review Synthetic premium', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review redemption', exact: true })).toBeFocused();
}
const confirm = (page: Page) => page.getByRole('checkbox', { name: /I reviewed the/ });
test('catalogue, URL ownership filter and explicit OBS limitation remain accessible', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible();
  await expect(page.getByText('OBS display support pending.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Owned templates', exact: true }).click();
  await expect(page).toHaveURL(/\/templates\?view=owned$/);
  await expect(page.getByRole('heading', { name: 'Standalone', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic premium' })).toHaveCount(0);
  await page.getByRole('link', { name: 'All templates', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic premium' })).toBeVisible();
  expect(state.posts).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('review is unchecked, keyboard operable and cancelled without a request', async ({ page }) => {
  const state = await scenario(page);
  await page.goto(base);
  await review(page);
  await expect(confirm(page)).not.toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Confirm redemption', exact: true }),
  ).toBeDisabled();
  await confirm(page).focus();
  await page.keyboard.press('Space');
  await expect(confirm(page)).toBeChecked();
  await page.getByRole('button', { name: 'Cancel review' }).click();
  await expect(
    page.getByRole('button', { name: 'Review Synthetic premium', exact: true }),
  ).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Review redemption', exact: true })).toHaveCount(
    0,
  );
  expect(state.posts).toEqual([]);
});
test('price race requires a fresh review of the new exact cost', async ({ page }) => {
  const state = await scenario(page);
  state.mode = 'price';
  await page.goto(base);
  await review(page);
  await confirm(page).check();
  await page.getByRole('button', { name: 'Confirm redemption', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Price changed — review again' })).toBeVisible();
  await review(page);
  await expect(confirm(page)).not.toBeChecked();
  await expect(confirm(page)).toHaveAccessibleName(/30 coin cost/);
  expect(state.posts).toHaveLength(1);
  state.mode = 'pending';
  await confirm(page).check();
  await page.getByRole('button', { name: 'Confirm redemption', exact: true }).click();
  await expect.poll(() => state.posts.length).toBe(2);
  expect(state.posts[1].key).not.toBe(state.posts[0].key);
  expect((JSON.parse(state.posts[1].body!) as { amount: string }).amount).toBe('30');
});
test('uncertain result preserves same request and resets confirmation on retry', async ({
  page,
}) => {
  const state = await scenario(page);
  state.mode = 'network';
  await page.goto(base);
  await review(page);
  await confirm(page).check();
  await page.getByRole('button', { name: 'Confirm redemption', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Redemption result unconfirmed' })).toBeVisible();
  await expect(confirm(page)).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Retry same redemption' })).toBeDisabled();
  await page.getByRole('link', { name: 'Owned templates', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Redemption result unconfirmed' })).toBeVisible();
  await page.getByRole('link', { name: 'All templates', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Review Synthetic premium', exact: true }),
  ).toBeDisabled();
  state.mode = 'pending';
  await confirm(page).check();
  await page.getByRole('button', { name: 'Retry same redemption' }).click();
  await expect(page.getByRole('heading', { name: 'Ownership verification pending' })).toBeVisible();
  expect(state.posts).toHaveLength(2);
  expect(state.posts[1]).toEqual(state.posts[0]);
});
test('transient command survives in-app navigation and never auto posts', async ({ page }) => {
  const state = await scenario(page);
  state.mode = 'network';
  await page.goto(base);
  await review(page);
  await confirm(page).check();
  await page.getByRole('button', { name: 'Confirm redemption', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Redemption result unconfirmed' })).toBeVisible();
  await page.getByRole('link', { name: 'View missions and coin history' }).click();
  await expect(page.getByRole('heading', { name: 'Coins', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Redemption result unconfirmed' })).toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});
test('pending is distinct from owned; refresh verifies without any second debit', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(base);
  await review(page);
  await confirm(page).check();
  await page.getByRole('button', { name: 'Confirm redemption', exact: true }).dblclick();
  await expect(page.getByRole('heading', { name: 'Ownership verification pending' })).toBeVisible();
  await expect(page.getByText('Ownership pending', { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(1);
  state.pending = false;
  await page.getByRole('button', { name: 'Refresh ownership', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Ownership verified', exact: true }),
  ).toBeFocused();
  await expect(page.getByRole('button', { name: 'Confirm redemption', exact: true })).toHaveCount(
    0,
  );
  expect(state.posts).toHaveLength(1);
});
test('insufficient balance and a rejected request never fabricate ownership', async ({ page }) => {
  const state = await scenario(page);
  state.mode = 'insufficient';
  await page.goto(base);
  await review(page);
  await confirm(page).check();
  await page.getByRole('button', { name: 'Confirm redemption', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Redemption was not completed' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review Synthetic premium', exact: true }),
  ).toBeDisabled();
  await expect(page.getByText('You do not have enough available coins.')).toBeVisible();
  expect(state.posts).toHaveLength(1);
});
test('safe long labels, exact huge coins, null prices and restrictions fit a narrow screen', async ({
  page,
}) => {
  const state = await scenario(page);
  state.name = '<img src=x onerror=alert(1)> ' + 'Long synthetic name '.repeat(5);
  state.balance = '9007199254740993';
  state.price = '9007199254740993';
  await page.setViewportSize({ width: 320, height: 850 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base);
  await expect(page.getByText('9,007,199,254,740,993', { exact: true })).toBeVisible();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  state.price = null;
  state.priceRevision = null;
  state.allowed = false;
  await page.getByRole('button', { name: 'Refresh ownership', exact: true }).click();
  await expect(page.getByText('Price not configured', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Review </ })).toBeDisabled();
  expect(state.posts).toEqual([]);
});
test('read failures and withdrawal retain truth without stale spending actions', async ({
  page,
}) => {
  const state = await scenario(page);
  state.owned = true;
  state.available = false;
  await page.goto(base);
  await expect(page.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review Synthetic premium', exact: true }),
  ).toHaveCount(0);
  state.readError = true;
  await page.getByRole('button', { name: 'Refresh ownership', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be verified');
  await expect(page.getByRole('heading', { name: 'Synthetic premium' })).toHaveCount(0);
  expect(state.posts).toEqual([]);
});
test('logout removes held private intent', async ({ page }) => {
  const state = await scenario(page);
  await page.goto(base);
  await review(page);
  const logout = page.getByRole('button', { name: 'Sign out', exact: true });
  if (!(await logout.isVisible()))
    await page.getByRole('button', { name: 'Open workspace navigation' }).click();
  await logout.click();
  await expect(page.getByRole('heading', { name: 'Review redemption', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Confirm redemption', exact: true })).toHaveCount(
    0,
  );
  expect(state.posts).toEqual([]);
});
