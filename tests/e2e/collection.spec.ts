import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  ids,
  syntheticSession,
  roundFixture,
  connectionFixture,
  discoveryFixture,
} from '../../src/services/collection/fixture.test-helper';
const fixture = 'http://127.0.0.1:4175/tests/fixtures/creator.html?view=collection';
async function capture(page: Page, name: string) {
  if (!process.env.F04_CAPTURE_DIR) return;
  await page.locator('main').focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `${process.env.F04_CAPTURE_DIR}/${name}-${test.info().project.name}.png`,
    fullPage: true,
  });
}
const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4175',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'X-CSRF-Token,Content-Type,Idempotency-Key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: cors,
    body: JSON.stringify(body),
  });
const envelope = (data: unknown) => ({
  schemaVersion: 1,
  serverTime: new Date().toISOString(),
  data,
});
const failure = (code: string) => ({
  ...envelope(null),
  data: undefined,
  error: {
    code,
    message: 'private fixture message',
    requestId: 'synthetic-collection',
    retryable: false,
    retryAfterSeconds: null,
    issues: [],
    refetch: null,
  },
});
type Options = {
  provider?: 'twitch' | 'youtube' | 'kick';
  start?: (route: Route) => Promise<void>;
  stop?: (route: Route) => Promise<void>;
  read?: (route: Route) => Promise<void>;
  partial?: boolean;
};
async function scenario(page: Page, options: Options = {}) {
  const provider = options.provider ?? 'twitch';
  let phase: 'preparing' | 'collecting' | 'closed' | 'failed' = 'preparing';
  let pinMode = 'off';
  const starts: { body: Record<string, unknown>; key: string | undefined }[] = [],
    stops: unknown[] = [];
  const value = () => {
    const result = roundFixture(phase, Date.now());
    result.data.provider = provider;
    result.data.announcementPinMode = pinMode;
    if (result.data.streamContext) result.data.streamContext.source = provider;
    return result;
  };
  await page.route('http://127.0.0.1:3310/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (url.pathname === '/api/session') {
      await json(route, syntheticSession);
      return;
    }
    if (url.pathname === '/api/connections') {
      await json(
        route,
        envelope({
          items: [connectionFixture(provider)],
          nextCursor: options.partial && !url.searchParams.has('cursor') ? ids.snapshot : null,
        }),
      );
      return;
    }
    if (url.pathname.endsWith('/broadcasts')) {
      const response = discoveryFixture();
      response.data.items[0].liveViewers.source = provider;
      await json(route, response);
      return;
    }
    if (url.pathname === '/api/rounds' && request.method() === 'POST') {
      pinMode = (request.postDataJSON() as { announcementPinMode: string }).announcementPinMode;
      starts.push({
        body: request.postDataJSON() as Record<string, unknown>,
        key: request.headers()['idempotency-key'],
      });
      if (options.start) await options.start(route);
      else await json(route, value(), 202);
      return;
    }
    if (url.pathname.endsWith('/collection/stop')) {
      stops.push(request.postDataJSON());
      if (options.stop) await options.stop(route);
      else {
        phase = 'failed';
        await json(route, value(), 202);
      }
      return;
    }
    if (url.pathname === '/api/rounds/' + ids.round) {
      if (options.read) await options.read(route);
      else await json(route, value());
      return;
    }
    await json(route, failure('RESOURCE_NOT_FOUND'), 404);
  });
  return { starts, stops };
}
for (const provider of ['twitch', 'youtube', 'kick'] as const)
  test(`synthetic ${provider} setup sends the exact source and explicit round pin choice`, async ({
    page,
  }) => {
    const state = await scenario(page, { provider });
    await page.goto(fixture);
    await page
      .getByRole('radio', {
        name: provider === 'youtube' ? 'YouTube' : provider === 'kick' ? 'Kick' : 'Twitch',
        exact: true,
      })
      .check();
    const start = page.getByRole('button', { name: 'Start collection', exact: true });
    await expect(start).toBeEnabled();
    const menu = page.getByRole('button', { name: 'Open workspace navigation' });
    if (test.info().project.name === 'desktop-chromium') await expect(menu).toBeHidden();
    else await expect(menu).toBeVisible();
    if (provider === 'twitch') await capture(page, 'setup');
    await page.getByLabel('Collection duration').fill('0');
    await expect(start).toBeDisabled();
    await page.getByLabel('Collection duration').fill('30');
    if (provider === 'twitch')
      await page
        .getByRole('checkbox', {
          name: 'Allow Darve to replace an existing pinned chat message for this collection.',
        })
        .check();
    else
      await expect(
        page.getByText('Automatic chat pinning is unavailable on this platform.'),
      ).toBeVisible();
    await start.click();
    await expect(
      page.getByRole('heading', { name: 'Preparing your collection', exact: true }),
    ).toBeVisible();
    if (provider === 'twitch') await capture(page, 'preparing');
    expect(state.starts).toHaveLength(1);
    expect(state.starts[0].body).toEqual({
      connectionId: ids.connection,
      broadcastId: ids.broadcast,
      collectionDurationSeconds: 30,
      announcementPinMode: provider === 'twitch' ? 'replace_existing' : 'off',
    });
    expect(state.starts[0].key).toMatch(/^[a-f0-9-]{36}$/);
    await expect(page.getByLabel('Remaining collection time')).toHaveText('Waiting');
  });
test('synthetic unconfirmed Start holds source/settings and explicitly retries the same operation', async ({
  page,
}) => {
  let calls = 0;
  const state = await scenario(page, {
    start: async (route) => {
      if (++calls === 1) await route.abort('failed');
      else await json(route, roundFixture(), 202);
    },
  });
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Start collection', exact: true }).click();
  await expect(page.getByText('The result is unconfirmed.', { exact: false })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'YouTube', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Collection duration')).toBeDisabled();
  await page.getByRole('button', { name: 'Retry the same Start request' }).click();
  await expect(
    page.getByRole('heading', { name: 'Preparing your collection', exact: true }),
  ).toBeVisible();
  expect(state.starts).toHaveLength(2);
  expect(state.starts[1]).toEqual(state.starts[0]);
});
test('synthetic round URL counts from server time, never posts Stop at zero and hides status after a failed read', async ({
  page,
}) => {
  let unavailable = false;
  const state = await scenario(page, {
    read: async (route) => {
      if (unavailable) {
        await route.abort('failed');
        return;
      }
      const result = roundFixture('collecting', Date.now() - 29500);
      result.serverTime = new Date().toISOString();
      await json(route, result);
    },
  });
  await page.goto(fixture + '&roundId=' + ids.round);
  if (process.env.F04_CAPTURE_DIR) {
    await page.getByRole('heading', { name: 'Collecting viewer ideas', exact: true }).waitFor();
    await capture(page, 'collecting');
  }
  await expect(page.getByLabel('Remaining collection time')).toHaveText('0s', { timeout: 5000 });
  expect(state.starts).toHaveLength(0);
  expect(state.stops).toHaveLength(0);
  unavailable = true;
  await expect(page.getByText('Current status is unavailable.', { exact: false })).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByLabel('Remaining collection time')).toHaveText('—');
  await expect(page.getByRole('button', { name: 'Stop collection', exact: true })).toBeDisabled();
});
test('synthetic stale Stop refreshes the round and requires a new reviewed confirmation', async ({
  page,
}) => {
  let version = 2;
  const state = await scenario(page, {
    read: async (route) => {
      const r = roundFixture(version === 4 ? 'closed' : 'collecting', Date.now());
      r.data.version = version;
      await json(route, r);
    },
    stop: async (route) => {
      if (version === 2) {
        version = 3;
        await json(route, failure('VERSION_CONFLICT'), 409);
      } else {
        version = 4;
        const r = roundFixture('closed', Date.now());
        r.data.version = 4;
        await json(route, r, 202);
      }
    },
  });
  await page.goto(fixture + '&roundId=' + ids.round);
  await page.getByRole('button', { name: 'Stop collection', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm stop', exact: true }).click();
  await expect(
    page.getByText('The collection changed. Close this dialog', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm stop', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Back to status', exact: true }).click();
  await page.getByRole('button', { name: 'Stop collection', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm stop', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Collection ended', exact: true })).toBeVisible();
  expect(state.stops).toEqual([{ expectedVersion: 2 }, { expectedVersion: 3 }]);
});
test('synthetic preparing cancellation has no active countdown or collected snapshot', async ({
  page,
}) => {
  await scenario(page);
  await page.goto(fixture + '&roundId=' + ids.round);
  await expect(page.getByLabel('Remaining collection time')).toHaveText('Waiting');
  await page.getByRole('button', { name: 'Cancel preparation', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Collection cancelled', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Preparation was cancelled before any collection window started.'),
  ).toBeVisible();
});
test('synthetic terminal 401 clears private collection state', async ({ page }) => {
  let expired = false;
  await scenario(page, {
    read: async (route) =>
      expired
        ? json(route, failure('SESSION_REQUIRED'), 401)
        : json(route, roundFixture('collecting', Date.now())),
  });
  await page.goto(fixture + '&roundId=' + ids.round);
  await expect(
    page.getByRole('heading', { name: 'Collecting viewer ideas', exact: true }),
  ).toBeVisible();
  expired = true;
  await expect(
    page.getByRole('heading', { name: 'Connect your stream to Darve', exact: true }),
  ).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('heading', { name: 'Round details', exact: true })).toHaveCount(0);
});
test('synthetic partial connection pages cannot be mistaken for a complete source list', async ({
  page,
}) => {
  await scenario(page, { partial: true });
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Start collection', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Load more accounts' }).click();
  await expect(page.getByRole('button', { name: 'Start collection', exact: true })).toBeEnabled();
});
test('synthetic workspace reflows at 320px and its keyboard drawer restores focus', async ({
  page,
}) => {
  await scenario(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Start collection', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const trigger = page.getByRole('button', { name: 'Open workspace navigation' });
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('synthetic invalid round IDs never become an API path', async ({ page }) => {
  let reads = 0;
  await scenario(page, {
    read: async (route) => {
      reads++;
      await json(route, roundFixture());
    },
  });
  await page.goto(fixture + '&roundId=not-a-uuid');
  await expect(
    page.getByRole('heading', { name: 'Collection unavailable', exact: true }),
  ).toBeVisible();
  expect(reads).toBe(0);
});
