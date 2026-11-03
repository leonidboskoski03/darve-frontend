import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  session,
  envelope,
  errorBody,
  ids,
  challenge,
  streamer,
  review,
  restriction,
  member,
} from '../../src/services/staff-admin/fixture.test-helper';
const api = 'http://127.0.0.1:3320',
  fixture = 'http://127.0.0.1:4175/tests/fixtures/staff-admin.html';
const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4175',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'Content-Type,X-Staff-CSRF,Idempotency-Key',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
};
const json = (route: Route, data: unknown, status = 200) =>
  route.fulfill({
    status,
    headers: cors,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
async function scenario(
  page: Page,
  { owner = true, lost = false, stale = false, fresh = false } = {},
) {
  const state = {
    challenge: challenge(),
    streamer: streamer(),
    reviews: [review()],
    restriction: restriction(),
    members: [member(true), member()],
    reads: [] as string[],
    writes: [] as { path: string; key: string | undefined; body: Record<string, unknown> }[],
    receipts: new Map<string, unknown>(),
    lost: false,
    stale: false,
    denied: false,
    expired: false,
  };
  await page.route(api + '/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/admin/v1/session')
      return json(
        route,
        state.expired ? errorBody() : envelope(session(owner)),
        state.expired ? 401 : 200,
      );
    if (url.pathname === '/admin/v1/auth/email-code') return json(route, errorBody(), 401);
    if (state.denied) return json(route, errorBody('NOT_FOUND'), 404);
    if (request.method() === 'GET') {
      state.reads.push(url.pathname + url.search);
      if (url.pathname === '/admin/v1/challenges')
        return json(
          route,
          envelope({
            items: [state.challenge],
            nextCursor: null,
            fundingBasis: 'stored_projection',
          }),
        );
      if (url.pathname === '/admin/v1/challenges/' + ids.challenge)
        return json(
          route,
          envelope({ challenge: state.challenge, fundingBasis: 'stored_projection' }),
        );
      if (url.pathname === '/admin/v1/streamers/' + ids.creator)
        return json(route, envelope(state.streamer));
      if (url.pathname.endsWith('/restrictions')) return json(route, envelope(state.restriction));
      if (url.pathname === '/admin/v1/reviews')
        return json(
          route,
          envelope({
            items: state.reviews.filter(
              (row) =>
                (!url.searchParams.get('userId') ||
                  row.userId === url.searchParams.get('userId')) &&
                (!url.searchParams.get('state') || row.state === url.searchParams.get('state')),
            ),
            nextCursor: null,
          }),
        );
      if (url.pathname === '/admin/v1/staff')
        return json(route, envelope({ items: state.members, nextCursor: null }));
      if (url.pathname === '/admin/v1/audit-events')
        return json(
          route,
          envelope({
            items: [
              {
                id: ids.other,
                actorId: ids.owner,
                action: 'staff.invitation.created',
                resourceId: ids.invitation,
                reason: 'Synthetic audit reason',
                createdAt: '2026-11-03T12:00:00.000Z',
              },
            ],
            nextCursor: null,
          }),
        );
      return json(route, errorBody('NOT_FOUND'), 404);
    }
    const raw: unknown = request.postDataJSON();
    if (typeof raw !== 'object' || !raw) throw Error('Invalid synthetic action');
    const body = raw as Record<string, unknown>,
      key = request.headers()['idempotency-key'];
    state.writes.push({ path: url.pathname, key, body });
    if (fresh) return json(route, errorBody('REAUTHENTICATION_REQUIRED'), 403);
    if (stale && !state.stale) {
      state.stale = true;
      state.restriction = { ...state.restriction, revision: 1, banned: true };
      return json(route, errorBody('STALE_VERSION'), 409);
    }
    if (key && state.receipts.has(key)) return json(route, envelope(state.receipts.get(key)));
    let result: unknown;
    if (url.pathname.endsWith('/restrictions')) {
      state.restriction = {
        ...state.restriction,
        banned: body.action === 'ban',
        revision: state.restriction.revision + 1,
      };
      result = state.restriction;
    } else if (url.pathname === '/admin/v1/reviews') {
      const row = {
        ...review(),
        challengeId: body.target === 'streamer' ? null : String(body.targetId),
        reason: String(body.reason),
        flagReason: String(body.reason),
      };
      state.reviews = [row];
      result = row;
    } else if (url.pathname.endsWith('/transitions')) {
      const row = state.reviews[0];
      state.reviews = [
        {
          ...row,
          state:
            body.state === 'in_review'
              ? 'in_review'
              : body.state === 'resolved'
                ? 'resolved'
                : 'open',
          revision: row.revision + 1,
          reason: String(body.reason),
        },
      ];
      result = state.reviews[0];
    } else if (url.pathname === '/admin/v1/invitations')
      result = {
        id: ids.invitation,
        role: body.role,
        state: 'pending',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        acceptanceUrl: 'http://127.0.0.1:4175/staff/enrol#invitation=' + 'a'.repeat(43),
      };
    else if (url.pathname.startsWith('/admin/v1/invitations/')) result = { revoked: true };
    else {
      const index = state.members.findIndex((row) => url.pathname.includes(row.id));
      const row = state.members[index];
      state.members[index] = {
        ...row,
        role:
          body.role === undefined
            ? row.role
            : body.role === 'OWNER_ADMIN'
              ? 'OWNER_ADMIN'
              : 'SUPPORT',
        active: body.action !== 'revoke',
        revision: row.revision + 1,
      };
      result = state.members[index];
    }
    if (key) state.receipts.set(key, result);
    if (lost && !state.lost) {
      state.lost = true;
      return route.abort();
    }
    return json(route, envelope(result));
  });
  return state;
}
async function confirm(
  page: Page,
  title: string,
  label: string,
  reason = 'Reviewed synthetic concern',
) {
  const form = page.getByRole('form', { name: title, exact: true });
  await form.getByLabel(title + ' reason (required)', { exact: true }).fill(reason);
  await expect(form.getByRole('button', { name: label, exact: true })).toBeDisabled();
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: label, exact: true }).click();
}
test('inspection preserves exact amounts, unavailable funding and literal source text without writes', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(fixture + '?view=challenge&id=' + ids.challenge + '&token=strip-me');
  await expect(
    page.getByText('<script>literal synthetic challenge</script>', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('9007199254740993 minor units · EUR', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Funding projection unavailable. No zero balance is inferred.', { exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.has('token')).toBe(false);
  expect(state.writes).toHaveLength(0);
  expect(
    await page.locator('script').filter({ hasText: 'literal synthetic challenge' }).count(),
  ).toBe(0);
});
test('review flag binds inspected target and requires an unchecked review', async ({ page }) => {
  const state = await scenario(page, { owner: false });
  await page.goto(fixture + '?view=challenge&id=' + ids.challenge);
  await confirm(page, 'Flag for manual review', 'Confirm review flag');
  await expect(page.getByText(/The server recorded this exact request/)).toBeVisible();
  expect(state.writes[0]?.body).toEqual({
    target: 'challenge',
    targetId: ids.challenge,
    reason: 'Reviewed synthetic concern',
  });
  await expect(page.getByRole('button', { name: 'Confirm ban', exact: true })).toHaveCount(0);
  expect(
    state.reads.some(
      (path) =>
        path.includes('/restrictions') ||
        path.startsWith('/admin/v1/staff') ||
        path.includes('/audit-events'),
    ),
  ).toBe(false);
});
test('uncertain ban survives refresh and retries one exact command without a duplicate revision', async ({
  page,
}) => {
  const state = await scenario(page, { lost: true });
  await page.goto(fixture + '?view=streamer&id=' + ids.creator);
  await confirm(page, 'Ban creator', 'Confirm ban');
  await expect(page.getByText(/The result is unconfirmed/)).toBeVisible();
  await page.getByRole('button', { name: 'Refresh current records', exact: true }).click();
  await expect(page.getByText(/Banned from new activity/)).toBeVisible();
  await page.getByRole('button', { name: 'Retry same staff action', exact: true }).click();
  await expect(page.getByText(/The server recorded this exact request/)).toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(state.writes[0]).toEqual(state.writes[1]);
  expect(state.restriction.revision).toBe(1);
  expect(state.writes[0]?.body).toMatchObject({
    action: 'ban',
    expectedVersion: 0,
    confirmation: { targetId: ids.creator, action: 'ban', expectedVersion: 0 },
  });
});
test('stale restriction discards confirmation and shows current state before another action', async ({
  page,
}) => {
  const state = await scenario(page, { stale: true });
  await page.goto(fixture + '?view=streamer&id=' + ids.creator);
  await confirm(page, 'Ban creator', 'Confirm ban');
  await expect(page.getByText(/This record changed or its page expired/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm unban', exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(1);
});
test('owner advances reviews one state at a time and preserves original flag reason', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(fixture);
  await confirm(page, 'Advance manual review', 'Confirm review transition', 'Now investigating');
  await expect(page.getByRole('heading', { name: /Review .*in review/ })).toBeVisible();
  await expect(page.getByText('Synthetic original flag', { exact: true })).toBeVisible();
  await confirm(page, 'Advance manual review', 'Confirm review transition', 'Review complete');
  await expect(page.getByRole('heading', { name: /Review .*resolved/ })).toBeVisible();
  expect(state.writes[1]?.body).toMatchObject({
    state: 'resolved',
    expectedVersion: 2,
    confirmation: { targetId: ids.review, state: 'resolved', expectedVersion: 2 },
  });
});
test('Support cannot preload owner tools even through a direct URL', async ({ page }) => {
  const state = await scenario(page, { owner: false });
  await page.goto(fixture + '?view=staff');
  await expect(
    page.getByText('These tools are not available with your current staff access.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(state.reads).toHaveLength(0);
  expect(state.writes).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Staff members', exact: true })).toHaveCount(0);
});
test('staff role and membership changes bind loaded IDs and revisions', async ({ page }) => {
  const state = await scenario(page);
  await page.goto(fixture + '?view=staff');
  const row = page.locator('.staff-admin-records>li').filter({ hasText: ids.support });
  const roleForm = row.getByRole('form', { name: 'Change staff role', exact: true });
  await roleForm
    .getByLabel('Change staff role reason (required)', { exact: true })
    .fill('Reviewed promotion');
  await roleForm.getByRole('checkbox').check();
  await roleForm.getByRole('button', { name: 'Confirm staff role change', exact: true }).click();
  await expect(row.getByText(/Revision 2/)).toBeVisible();
  expect(state.writes[0]?.body).toEqual({
    action: 'change_role',
    role: 'OWNER_ADMIN',
    expectedVersion: 1,
    reason: 'Reviewed promotion',
  });
  const revokeForm = row.getByRole('form', { name: 'Revoke staff membership', exact: true });
  await revokeForm
    .getByLabel('Revoke staff membership reason (required)', { exact: true })
    .fill('Reviewed revocation');
  await revokeForm.getByRole('checkbox').check();
  await revokeForm.getByRole('button', { name: 'Confirm staff revocation', exact: true }).click();
  await expect(row.getByText('This membership is inactive.', { exact: true })).toBeVisible();
  expect(state.writes[1]?.body).toEqual({
    action: 'revoke',
    expectedVersion: 2,
    reason: 'Reviewed revocation',
  });
});
test('invitation link requires deliberate reveal and stays out of storage, queries and navigation', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(fixture + '?view=staff');
  await page.getByLabel('Invited identity', { exact: true }).fill('synthetic@example.test');
  await confirm(page, 'Create staff invitation', 'Confirm invitation creation');
  await expect(
    page.getByRole('heading', { name: 'Invitation recorded', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Private invitation link', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show private invitation link', exact: true }).click();
  expect(await page.getByLabel('Private invitation link', { exact: true }).inputValue()).toContain(
    '#invitation=',
  );
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain('invitation=');
  expect(page.url()).not.toContain('invitation=');
  await page.getByRole('button', { name: 'Refresh current records', exact: true }).click();
  await expect(page.getByLabel('Private invitation link', { exact: true })).toHaveCount(0);
  await page.getByLabel('Invitation ID to revoke', { exact: true }).fill(ids.invitation);
  await confirm(page, 'Revoke invitation', 'Confirm invitation revocation');
  expect(state.writes[1]?.path).toBe('/admin/v1/invitations/' + ids.invitation);
});
test('fresh assurance failure clears forms and requires explicit identity verification without replay', async ({
  page,
}) => {
  const state = await scenario(page, { fresh: true });
  await page.goto(fixture + '?view=streamer&id=' + ids.creator);
  await confirm(page, 'Ban creator', 'Confirm ban');
  await expect(page.getByText(/This action needs fresh identity verification/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Verify identity again', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm ban', exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
});
test('lost inspection access clears private text and draft reasons on authoritative refresh', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(fixture + '?view=challenge&id=' + ids.challenge);
  await page
    .getByLabel('Flag for manual review reason (required)', { exact: true })
    .fill('Discard private draft');
  state.denied = true;
  await page.getByRole('button', { name: 'Refresh current records', exact: true }).click();
  await expect(page.getByText(/This record or action is unavailable/)).toBeVisible();
  await expect(
    page.getByText('<script>literal synthetic challenge</script>', { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});
test('URL-applied filters reload safely and narrow-screen tools support keyboard, reduced motion and axe', async ({
  page,
}) => {
  await scenario(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto(fixture);
  await page.getByLabel('Creator filter ID', { exact: true }).fill(ids.creator);
  await page.getByLabel('Review state', { exact: true }).selectOption('open');
  await page.getByRole('button', { name: 'Apply record filters', exact: true }).click();
  await expect(page).toHaveURL(/owner=12345678/);
  // This synthetic fixture shares a preview host with the public entry. Actual staff reload is qualified separately.
  await page.goto(fixture + new URL(page.url()).search);
  await expect(page.getByLabel('Review state', { exact: true })).toHaveValue('open');
  await expect(page.getByLabel('Creator filter ID', { exact: true })).toHaveValue(ids.creator);
  await page.getByLabel('Creator filter ID', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Review state', { exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('repeated view changes and refreshes never leave orphaned filters or duplicate record panes', async ({
  page,
}) => {
  await scenario(page);
  await page.goto(fixture);
  for (let count = 0; count < 3; count++) {
    await page.getByRole('button', { name: 'Staff members', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Invitations', exact: true })).toBeVisible();
    await expect(page.locator('.staff-admin-filters')).toHaveCount(0);
    await page.getByRole('button', { name: 'Refresh current records', exact: true }).click();
    await expect(page.locator('.staff-admin-records')).toHaveCount(1);
    await page.getByRole('button', { name: 'Manual reviews', exact: true }).click();
    await expect(page.locator('.staff-admin-filters')).toHaveCount(1);
    await expect(page.locator('.staff-admin-records')).toHaveCount(1);
  }
  await page.getByRole('button', { name: 'Audit history', exact: true }).click();
  await expect(page.getByText('Synthetic audit reason', { exact: true })).toBeVisible();
  await expect(page.locator('.staff-admin-filters')).toHaveCount(0);
  await expect(page.locator('.staff-admin-records')).toHaveCount(1);
});
