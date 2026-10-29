import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  dashboardFixture,
  reportingChallenge,
  analyticsFixture,
  declarationFixture,
  syntheticReportingSession,
  reportingIds as ids,
  stamp,
} from '../../src/services/reporting/fixture.test-helper';
import {
  connectionFixture,
  discoveryFixture,
} from '../../src/services/collection/fixture.test-helper';
const base = 'http://127.0.0.1:4175/tests/fixtures/creator.html';
const fixture = (view: string, extra = '') =>
  `${base}?view=${view}&timeZone=UTC&challengeId=${ids.challenge}&roundId=${ids.round}${extra}`;
const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4175',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'X-CSRF-Token,Content-Type,Idempotency-Key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
const envelope = (data: unknown) => ({ schemaVersion: 1, serverTime: stamp, data });
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: cors,
    body: JSON.stringify(body),
  });
const failure = (code: string) => ({
  schemaVersion: 1,
  serverTime: stamp,
  error: {
    code,
    message: 'private fixture message',
    requestId: 'synthetic-reporting',
    retryable: false,
    retryAfterSeconds: null,
    issues: [],
    refetch: null,
  },
});
async function scenario(
  page: Page,
  options: { partial?: boolean; declare?: (route: Route) => Promise<void> } = {},
) {
  const second = reportingChallenge();
  second.id = ids.other;
  second.funding.state = 'pending';
  second.performance.state = 'awaiting_funding';
  const state = {
    summary: dashboardFixture(),
    challenge: reportingChallenge(),
    analytics: analyticsFixture(),
    second,
    summaryQueries: [] as string[],
    declarations: [] as { key: string | undefined; body: unknown }[],
    reads: [] as string[],
    expired: false,
    readFailure: false,
  };
  await page.route('http://127.0.0.1:3310/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (url.pathname === '/api/session') {
      await json(route, syntheticReportingSession);
      return;
    }
    if (state.expired) {
      await json(route, failure('SESSION_REQUIRED'), 401);
      return;
    }
    if (url.pathname === '/api/connections') {
      await json(route, envelope({ items: [connectionFixture()], nextCursor: null }));
      return;
    }
    if (url.pathname.endsWith('/broadcasts')) {
      await json(route, discoveryFixture());
      return;
    }
    if (url.pathname === '/api/dashboard/summary') {
      state.summaryQueries.push(url.search);
      const data = structuredClone(state.summary);
      data.period.timeZone = url.searchParams.get('timeZone')!;
      if (url.searchParams.has('fromDate')) {
        data.period.fromDate = url.searchParams.get('fromDate')!;
        data.period.throughDate = url.searchParams.get('throughDate')!;
        data.period.startInclusive = '2026-03-28T23:00:00.000Z';
        data.period.endExclusive = '2026-03-29T22:00:00.000Z';
      }
      if (url.searchParams.has('broadcastId'))
        data.currentStream = {
          selection: 'selected',
          broadcastId: url.searchParams.get('broadcastId'),
          provider: 'TWITCH',
          state: 'unavailable',
          reason: 'observation_stale',
          observedAt: null,
          freshUntil: null,
          liveViewers: null,
          totals: null,
        };
      await json(route, envelope(data));
      return;
    }
    if (url.pathname.endsWith('/completion-declarations')) {
      state.declarations.push({
        key: request.headers()['idempotency-key'],
        body: request.postDataJSON(),
      });
      if (options.declare) {
        await options.declare(route);
        return;
      }
      state.challenge.performance = {
        ...state.challenge.performance,
        revision: 2,
        state: 'declared_complete',
        declarationId: ids.other,
        declaredAt: stamp,
        streamContextStatus: 'confirmed_original_broadcast',
      };
      const ack = declarationFixture();
      ack.data.provider = state.challenge.stream.provider;
      if (state.challenge.performanceAuthority?.revision) {
        ack.schemaVersion = 2;
        ack.data = {
          ...ack.data,
          broadcastId: state.challenge.performanceAuthority.broadcastId,
          performanceAuthorityRevision: state.challenge.performanceAuthority.revision,
          continuationId: state.challenge.performanceAuthority.authorizationId!,
        };
        state.challenge.performance.streamContextStatus = 'confirmed_authorized_broadcast';
      }
      await json(route, ack, 201);
      return;
    }
    state.reads.push(url.pathname);
    if (state.readFailure) {
      await route.abort('failed');
      return;
    }
    if (url.pathname === '/api/challenges' || url.pathname === '/api/challenges/current') {
      const current = url.pathname.endsWith('/current');
      const all = current ? [state.challenge] : [state.challenge, state.second];
      const items =
        options.partial && !current
          ? all.slice(
              url.searchParams.has('cursor') ? 1 : 0,
              url.searchParams.has('cursor') ? 2 : 1,
            )
          : all;
      await json(
        route,
        envelope({
          items,
          nextCursor:
            options.partial && !current && !url.searchParams.has('cursor')
              ? stamp + '|' + ids.challenge
              : null,
        }),
      );
      return;
    }
    if (url.pathname === '/api/challenges/' + ids.challenge) {
      await json(route, envelope(state.challenge));
      return;
    }
    if (url.pathname.endsWith('/analytics')) {
      await json(route, envelope(state.analytics));
      return;
    }
    await route.fulfill({ status: 404, headers: cors });
  });
  return state;
}
async function capture(page: Page, name: string) {
  if (!process.env.F05_CAPTURE_DIR) return;
  await page.locator('main').focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `${process.env.F05_CAPTURE_DIR}/${name}-${test.info().project.name}.png`,
    fullPage: true,
  });
}
async function openDeclaration(page: Page) {
  await page.getByRole('button', { name: 'Declare completion', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Declare challenge completion', exact: true }),
  ).toBeVisible();
}
const consent = 'I confirm I completed this challenge on its original or authorized stream.';
test('synthetic dashboard keeps exact currency rows, unknown adjustments and audience separate', async ({
  page,
}) => {
  await scenario(page);
  await page.goto(fixture('dashboard'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('90071992547409.93 EUR', { exact: true })).toBeVisible();
  await expect(page.getByText('10.07 USD', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Historical audience is unavailable.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('Includes a partial current day.', { exact: false })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Payments needing timing review', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('No broadcast is selected.', { exact: false })).toBeVisible();
  await capture(page, 'dashboard');
});
test('synthetic reporting applies paired civil dates and timezone through the URL without client day arithmetic', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(fixture('dashboard'), { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { name: 'Date-filtered history', exact: true }),
  ).toBeVisible();
  const count = state.summaryQueries.length;
  await page.getByLabel('From date', { exact: true }).fill('2026-03-29');
  await page.getByRole('button', { name: 'Apply reporting filters', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(state.summaryQueries).toHaveLength(count);
  await page.getByLabel('Through date', { exact: true }).fill('2026-03-29');
  await page.getByLabel('Reporting timezone', { exact: true }).fill('Europe/Warsaw');
  await page.getByRole('button', { name: 'Apply reporting filters', exact: true }).click();
  await expect(page).toHaveURL(/timeZone=Europe%2FWarsaw/);
  await expect(page.getByText('Server interval:', { exact: false })).toContainText(
    '2026-03-28T23:00:00.000Z inclusive to 2026-03-29T22:00:00.000Z exclusive',
  );
  expect(state.summaryQueries.at(-1)).toContain('fromDate=2026-03-29');
});
test('synthetic owned stream selection is deliberate and unavailable samples are not zero', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(fixture('dashboard'), { waitUntil: 'domcontentloaded' });
  await page.getByText('Choose a broadcast', { exact: true }).click();
  await page.getByRole('combobox', { name: /Reporting broadcast/ }).selectOption(ids.broadcast);
  expect(state.summaryQueries.at(-1)).not.toContain('broadcastId=');
  await page.getByRole('button', { name: 'Apply reporting filters', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('broadcastId=' + ids.broadcast));
  await expect(
    page.getByText('Current broadcast viewer sample: Unavailable', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Broadcast totals are unavailable.', { exact: true })).toBeVisible();
});
test('synthetic history preserves overlapping pages, status filters and server funding-window scope', async ({
  page,
}) => {
  await scenario(page, { partial: true });
  await page.goto(fixture('history'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('1 retained challenges loaded;', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Load more challenges', exact: true }).click();
  await expect(page.getByText('2 retained challenges loaded;', { exact: false })).toBeVisible();
  await page.getByRole('combobox', { name: /Filter loaded challenges/ }).selectOption('declared');
  await expect(page).toHaveURL(/status=declared/);
  await expect(
    page.getByRole('heading', { name: 'No matching challenges', exact: true }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: /Filter loaded challenges/ }).selectOption('all');
  await expect(page.getByRole('article')).toHaveCount(2);
  await capture(page, 'history');
  await page.getByRole('button', { name: 'Open funding windows', exact: true }).click();
  await expect(page).toHaveURL(/scope=current/);
  await expect(page.getByRole('article')).toHaveCount(1);
});
test('synthetic goal recognition never declares completion automatically', async ({ page }) => {
  const state = await scenario(page);
  await page.goto(fixture('challenge'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Awaiting your declaration', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Declare completion', exact: true })).toBeEnabled();
  expect(state.declarations).toHaveLength(0);
  await capture(page, 'challenge');
});
for (const provider of ['twitch', 'youtube', 'kick'] as const)
  test(`synthetic ${provider} completion confirms immutable original-stream terms and reconciles the projection`, async ({
    page,
  }) => {
    const state = await scenario(page);
    state.challenge.stream.provider = provider;
    await page.goto(fixture('challenge'), { waitUntil: 'domcontentloaded' });
    await openDeclaration(page);
    await expect(page.getByRole('checkbox', { name: consent, exact: true })).not.toBeChecked();
    await expect(
      page.getByRole('button', { name: 'Confirm completion declaration', exact: true }),
    ).toBeDisabled();
    expect(state.declarations).toHaveLength(0);
    await page.getByRole('checkbox', { name: consent, exact: true }).check();
    if (process.env.F05_CAPTURE_DIR)
      await page.screenshot({
        path: `${process.env.F05_CAPTURE_DIR}/declaration-${test.info().project.name}.png`,
        fullPage: true,
      });
    await page.getByRole('button', { name: 'Confirm completion declaration', exact: true }).click();
    await expect(
      page.getByText('Your completion declaration was recorded', { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Declare completion', exact: true })).toHaveCount(
      0,
    );
    expect(state.declarations).toHaveLength(1);
    expect(state.declarations[0].body).toEqual({ expectedVersion: 1, termsVersion: ids.terms });
  });
test('synthetic continuation uses authority revision while keeping expected performance version one', async ({
  page,
}) => {
  const state = await scenario(page);
  state.challenge.version = 2;
  state.challenge.performanceAuthority = {
    version: 1,
    revision: 1,
    authorizationId: ids.other,
    originalBroadcastId: ids.broadcast,
    broadcastId: ids.round,
  };
  await page.goto(fixture('challenge'), { waitUntil: 'domcontentloaded' });
  await openDeclaration(page);
  await expect(page.getByRole('dialog')).toContainText('Authorized stream reference');
  await page.getByRole('checkbox', { name: consent, exact: true }).check();
  await page.getByRole('button', { name: 'Confirm completion declaration', exact: true }).click();
  await expect(
    page.getByText('Your completion declaration was recorded', { exact: false }),
  ).toBeVisible();
  expect(state.declarations[0].body).toEqual({
    expectedVersion: 1,
    termsVersion: ids.terms,
    expectedPerformanceRevision: 1,
  });
});
test('synthetic uncertain declaration keeps the same body and key for deliberate replay', async ({
  page,
}) => {
  let calls = 0;
  const state = await scenario(page, {
    declare: async (route) => {
      if (++calls === 1) await route.abort('failed');
      else await json(route, declarationFixture(), 200);
    },
  });
  await page.goto(fixture('challenge'), { waitUntil: 'domcontentloaded' });
  await openDeclaration(page);
  await page.getByRole('checkbox', { name: consent, exact: true }).check();
  await page.getByRole('button', { name: 'Confirm completion declaration', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry same declaration', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(state.declarations).toHaveLength(1);
  await page.getByRole('button', { name: 'Retry same declaration', exact: true }).click();
  await expect(
    page.getByText('Your completion declaration was recorded', { exact: false }),
  ).toBeVisible();
  expect(state.declarations[1]).toEqual(state.declarations[0]);
});
test('synthetic stale terms require a refreshed confirmation instead of automatic replay', async ({
  page,
}) => {
  const state = await scenario(page, {
    declare: async (route) => {
      state.challenge.terms.version = ids.other;
      await json(route, failure('TERMS_CHANGED'), 409);
    },
  });
  await page.goto(fixture('challenge'), { waitUntil: 'domcontentloaded' });
  await openDeclaration(page);
  await page.getByRole('checkbox', { name: consent, exact: true }).check();
  await page.getByRole('button', { name: 'Confirm completion declaration', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('The challenge terms changed.');
  await expect(
    page.getByRole('button', { name: 'Confirm completion declaration', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to challenge', exact: true }).click();
  await openDeclaration(page);
  await expect(page.getByRole('checkbox', { name: consent, exact: true })).not.toBeChecked();
  expect(state.declarations).toHaveLength(1);
});
test('synthetic unfunded and restricted challenges never offer a declaration', async ({ page }) => {
  const state = await scenario(page);
  state.challenge.funding.state = 'pending';
  state.challenge.performance.state = 'awaiting_funding';
  await page.goto(fixture('challenge'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Challenge details', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Declare completion', exact: true })).toHaveCount(
    0,
  );
  state.challenge.contentAvailability = 'unavailable';
  state.challenge.terms.text = null;
  state.challenge.authors = [];
  await page.getByRole('button', { name: 'Refresh challenge details', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Challenge content unavailable', exact: true }),
  ).toBeVisible();
  expect(state.declarations).toHaveLength(0);
});
test('synthetic analytics distinguishes unavailable, zero, partial counts and current audience', async ({
  page,
}) => {
  await scenario(page);
  await page.goto(fixture('analytics'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('No accepted challenge is associated', { exact: false })).toHaveCount(
    0,
  );
  await expect(page.getByText('Partial capture', { exact: false })).toBeVisible();
  await expect(page.getByText('2 · Partial', { exact: true })).toBeVisible();
  await expect(page.getByText('This is not historical audience', { exact: false })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'View accepted challenge', exact: true }),
  ).toHaveAttribute('href', '/challenges/' + ids.challenge);
  await capture(page, 'analytics');
});
test('synthetic reporting expiry hides private content and invalid paths never become resource reads', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(fixture('challenge'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Declare completion', exact: true })).toBeVisible();
  state.expired = true;
  await page.getByRole('button', { name: 'Refresh challenge details', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Connect your stream to Darve', exact: true }),
  ).toBeVisible();
});
test('synthetic invalid reporting resource is rejected without transport', async ({ page }) => {
  const state = await scenario(page);
  await page.goto(base + '?view=challenge&challengeId=not-a-uuid', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('alert')).toBeVisible();
  expect(state.reads).toHaveLength(0);
});
test('synthetic reporting and declaration support 320px reflow, reduced motion, axe and focus return', async ({
  page,
}) => {
  await scenario(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(fixture('dashboard'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('90071992547409.93 EUR', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto(fixture('challenge'), { waitUntil: 'domcontentloaded' });
  await openDeclaration(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Declare completion', exact: true })).toBeFocused();
});
