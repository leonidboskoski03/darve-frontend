import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  reviewFixture,
  acceptedFixture,
  challengeFixture,
  reviewIds as ids,
} from '../../src/services/suggestions/fixture.test-helper';
import { syntheticSession } from '../../src/services/collection/fixture.test-helper';
import type { SuggestionPageResponseSchema } from '../../src/services/contracts/index';
type ReviewPage = ReturnType<typeof SuggestionPageResponseSchema.parse>['data'];
const fixture = `http://127.0.0.1:4175/tests/fixtures/creator.html?view=review&roundId=${ids.round}`;
const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4175',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'X-CSRF-Token,Content-Type,Idempotency-Key',
  'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
};
const envelope = (data: unknown) => ({
  schemaVersion: 1,
  serverTime: new Date().toISOString(),
  data,
});
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: cors,
    body: JSON.stringify(body),
  });
const failure = (code: string) => ({
  schemaVersion: 1,
  serverTime: new Date().toISOString(),
  error: {
    code,
    message: 'private fixture message',
    requestId: 'synthetic-review',
    retryable: false,
    retryAfterSeconds: null,
    issues: [],
    refetch: null,
  },
});
async function scenario(
  page: Page,
  options: {
    partial?: boolean;
    accept?: (route: Route) => Promise<void>;
    disposition?: (route: Route) => Promise<void>;
  } = {},
) {
  const state: {
    data: ReviewPage;
    expired: boolean;
    accepts: { body: Record<string, unknown>; key: string | undefined }[];
    patches: unknown[];
    reads: number;
  } = { data: reviewFixture(), expired: false, accepts: [], patches: [], reads: 0 };
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
    if (state.expired) {
      await json(route, failure('SESSION_REQUIRED'), 401);
      return;
    }
    if (url.pathname.endsWith('/accept')) {
      state.accepts.push({
        body: request.postDataJSON() as Record<string, unknown>,
        key: request.headers()['idempotency-key'],
      });
      if (options.accept) await options.accept(route);
      else {
        state.data.items[0].selectedChallengeId = ids.challenge;
        await json(route, envelope(acceptedFixture()), 201);
      }
      return;
    }
    if (url.pathname.endsWith('/disposition')) {
      state.patches.push(request.postDataJSON());
      if (options.disposition) {
        await options.disposition(route);
        return;
      }
      const item = state.data.items.find((value) => url.pathname.includes(value.id))!;
      const body = request.postDataJSON() as { pinned: boolean; dismissed: boolean };
      item.pinned = body.pinned;
      item.dismissed = body.dismissed;
      item.version++;
      await json(route, envelope(item));
      return;
    }
    if (url.pathname === '/api/challenges/' + ids.challenge) {
      await json(route, challengeFixture());
      return;
    }
    if (url.pathname.endsWith('/suggestions')) {
      state.reads++;
      const data = structuredClone(state.data);
      if (options.partial) {
        data.items = state.data.items.slice(
          url.searchParams.has('cursor') ? 1 : 0,
          url.searchParams.has('cursor') ? 2 : 1,
        );
        data.nextCursor = url.searchParams.has('cursor') ? null : data.resultVersion + '.1';
      }
      await json(route, envelope(data));
      return;
    }
    await route.fulfill({ status: 404, headers: cors });
  });
  return state;
}
async function openTerms(page: Page) {
  await page.getByRole('button', { name: 'Accept idea 1', exact: true }).click();
  await page.getByLabel('Funding goal', { exact: true }).fill('25.50');
  await page.getByLabel('Funding duration in seconds', { exact: true }).fill('600');
  await page.getByRole('button', { name: 'Review exact terms', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Confirm challenge terms', exact: true }),
  ).toBeVisible();
}
async function capture(page: Page, name: string) {
  if (!process.env.F04_CAPTURE_DIR) return;
  await page.locator('main').focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `${process.env.F04_CAPTURE_DIR}/${name}-${test.info().project.name}.png`,
    fullPage: true,
  });
}
test('synthetic review preserves duplicate names, all credits, memberships and literal viewer text', async ({
  page,
}) => {
  const state = await scenario(page);
  state.data.items[0].text = '<img src=x onerror=alert(1)> ' + 'A'.repeat(200);
  await page.goto(fixture);
  await expect(
    page.getByRole('heading', { name: 'Review viewer ideas', exact: true }),
  ).toBeVisible();
  const idea = page.getByRole('article', { name: 'Idea 1', exact: true });
  await idea.getByText('All 2 author credits · 2 source submissions', { exact: true }).click();
  await expect(idea.getByText('Same viewer', { exact: true })).toHaveCount(2);
  await expect(idea.getByText('Account viewer-a', { exact: false })).toBeVisible();
  await expect(idea.locator('img')).toHaveCount(0);
  await expect(idea.getByRole('heading')).toContainText('<img src=x');
  await expect(
    idea.getByText('Original message links are not available for these sources.'),
  ).toBeVisible();
  await expect(idea.locator('a')).toHaveCount(0);
  expect(state.accepts).toHaveLength(0);
});
test('synthetic filters describe loaded pages and retain publication-bound pagination', async ({
  page,
}) => {
  await scenario(page, { partial: true });
  await page.goto(fixture + '&filter=recommended');
  await expect(page.getByText('1 of 2 safe ideas loaded.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Load more ideas', exact: true }).click();
  await expect(page.getByText('2 of 2 safe ideas loaded.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'All safe', exact: true }).click();
  await expect(page).not.toHaveURL(/filter=/);
  await expect(page.getByRole('article')).toHaveCount(2);
  if (test.info().project.name === 'desktop-chromium') {
    const all = await page.getByRole('button', { name: 'All safe', exact: true }).boundingBox();
    const recommended = await page
      .getByRole('button', { name: 'Recommended', exact: true })
      .boundingBox();
    expect(all?.y).toBe(recommended?.y);
  }
  await capture(page, 'review');
});
test('synthetic pin, dismiss and restore are explicit versioned metadata actions', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Pin idea 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unpin idea 1', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Dismiss idea 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept idea 1', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Restore idea 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept idea 1', exact: true })).toBeEnabled();
  expect(state.patches).toEqual([
    { expectedVersion: 1, pinned: true, dismissed: false },
    { expectedVersion: 2, pinned: false, dismissed: true },
    { expectedVersion: 3, pinned: false, dismissed: false },
  ]);
  expect(state.accepts).toHaveLength(0);
});
test('synthetic acceptance reviews exact money and keeps other ideas after confirmed creation', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(fixture);
  await openTerms(page);
  expect(state.accepts).toHaveLength(0);
  await expect(page.getByRole('dialog')).toContainText('25.50 EUR');
  await expect(page.getByRole('dialog')).toContainText('600 seconds');
  if (process.env.F04_CAPTURE_DIR)
    await page.screenshot({
      path: `${process.env.F04_CAPTURE_DIR}/accept-${test.info().project.name}.png`,
      fullPage: true,
    });
  await page.getByRole('button', { name: 'Confirm acceptance', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Accepted challenge', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Awaiting funding', { exact: true })).toBeVisible();
  expect(state.accepts[0].body).toEqual({
    expectedVersion: 1,
    analysisRunId: ids.run,
    resultVersion: ids.result,
    snapshotVersion: 3,
    goal: { amountMinor: '2550', currency: 'EUR' },
    fundingDurationSeconds: 600,
  });
  await expect(page.getByRole('article', { name: 'Idea 2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept idea 2', exact: true })).toBeDisabled();
});
test('synthetic uncertain acceptance retries only the identical held body and key', async ({
  page,
}) => {
  let calls = 0;
  const state = await scenario(page, {
    accept: async (route) => {
      if (++calls === 1) await route.abort('failed');
      else await json(route, envelope(acceptedFixture()), 200);
    },
  });
  await page.goto(fixture);
  await openTerms(page);
  await page.getByRole('button', { name: 'Confirm acceptance', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry same acceptance', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to review', exact: true })).toBeDisabled();
  expect(state.accepts).toHaveLength(1);
  await page.getByRole('button', { name: 'Retry same acceptance', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Accepted challenge', exact: true }),
  ).toBeVisible();
  expect(state.accepts).toHaveLength(2);
  expect(state.accepts[1]).toEqual(state.accepts[0]);
});
test('synthetic acceptance conflict requires a refreshed deliberate review', async ({ page }) => {
  const state = await scenario(page, {
    accept: async (route) => {
      state.data.items[0].version = 2;
      await json(route, failure('STALE_VERSION'), 409);
    },
  });
  await page.goto(fixture);
  await openTerms(page);
  await page.getByRole('button', { name: 'Confirm acceptance', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('The result or idea changed.');
  await expect(page.getByRole('button', { name: 'Confirm acceptance', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Back to review', exact: true }).click();
  await openTerms(page);
  expect(state.accepts).toHaveLength(1);
});
test('synthetic empty, failed, restricted and processing results are distinct with no acceptance', async ({
  page,
}) => {
  const state = await scenario(page);
  for (const status of ['empty', 'failed', 'restricted', 'queued', 'running', 'pending'] as const) {
    state.data = {
      ...reviewFixture(),
      items: [],
      resultVersion: null,
      totalSafeCount: 0,
      recommendedCount: 0,
      analysis: {
        snapshotId: ids.snapshot,
        snapshotVersion: 3,
        analysisRunId: ['empty', 'pending'].includes(status) ? null : ids.run,
        state: status,
        resultVersion: null,
      },
    };
    await page.goto(fixture);
    await expect(
      page.getByRole('heading', { name: 'Collection results', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept idea 1', exact: true })).toHaveCount(0);
  }
  expect(state.accepts).toHaveLength(0);
});
test('synthetic restricted refresh and expired authority remove private suggestions', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(fixture);
  await expect(page.getByRole('article')).toHaveCount(2);
  state.data = {
    ...state.data,
    items: [],
    resultVersion: null,
    totalSafeCount: 0,
    recommendedCount: 0,
    analysis: { ...state.data.analysis!, state: 'restricted', resultVersion: null },
  };
  await page.getByRole('button', { name: 'Refresh results', exact: true }).click();
  await expect(page.getByText('These source ideas are restricted.', { exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  state.expired = true;
  await page.getByRole('button', { name: 'Refresh results', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Connect your stream to Darve', exact: true }),
  ).toBeVisible();
});
test('synthetic review and confirmation reflow at 320px and support keyboard and axe', async ({
  page,
}) => {
  await scenario(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(fixture);
  await openTerms(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Accept idea 1', exact: true })).toBeFocused();
});

test('synthetic changed publication cannot mix old and new cursor pages', async ({ page }) => {
  const state = await scenario(page, { partial: true });
  await page.goto(fixture);
  await expect(page.getByRole('article')).toHaveCount(1);
  state.data.resultVersion = ids.source;
  state.data.analysis!.resultVersion = ids.source;
  state.data.items = state.data.items.map((item, index) => ({
    ...item,
    id: ids.source + '.g' + (index + 1),
  }));
  await page.getByRole('button', { name: 'Load more ideas', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh results', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  expect(state.accepts).toHaveLength(0);
});
test('synthetic unconfigured commercial policy is a definite unavailable prerequisite', async ({
  page,
}) => {
  const state = await scenario(page, {
    accept: (route) => json(route, failure('POLICY_UNAVAILABLE'), 503),
  });
  await page.goto(fixture);
  await openTerms(page);
  await page.getByRole('button', { name: 'Confirm acceptance', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Challenge terms are not configured on the server.',
  );
  await expect(
    page.getByRole('button', { name: 'Retry same acceptance', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to review', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.accepts).toHaveLength(1);
});
