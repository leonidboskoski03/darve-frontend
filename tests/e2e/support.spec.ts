import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  ids,
  ticket,
  message,
  envelope,
  errorBody,
} from '../../src/services/support/fixture.test-helper';
import { syntheticReportingSession } from '../../src/services/reporting/fixture.test-helper';
const fixture = (id = '') =>
  'http://127.0.0.1:4175/tests/fixtures/creator.html?view=support' + (id ? '&ticketId=' + id : '');
const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4175',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'X-CSRF-Token,Content-Type,Idempotency-Key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
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
  options: {
    noTerms?: boolean;
    empty?: boolean;
    messages?: number;
    lostReply?: boolean;
    denied?: boolean;
    stalePage?: boolean;
  } = {},
) {
  const state = {
    current: ticket(),
    messages: Array.from({ length: options.messages ?? 2 }, (_, n) => message(n + 1)),
    created: !options.empty,
    posts: [] as { path: string; key: string | undefined; body: Record<string, unknown> }[],
    events: 0,
    reads: [] as string[],
    receipts: new Map<string, unknown>(),
    lost: false,
    expired: false,
    denied: Boolean(options.denied),
    privateNote: 'PRIVATE-NOTE-MUST-STAY-HIDDEN',
  };
  await page.route('http://127.0.0.1:3310/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (url.pathname === '/api/session') {
      await json(
        route,
        options.noTerms
          ? {
              ...syntheticReportingSession,
              user: {
                ...syntheticReportingSession.user,
                termsStatus: {
                  status: 'unconfigured',
                  requiredVersion: null,
                  acceptedVersion: null,
                  acceptedAt: null,
                },
              },
            }
          : syntheticReportingSession,
      );
      return;
    }
    if (state.expired) {
      await json(route, errorBody('SESSION_REQUIRED'), 401);
      return;
    }
    if (url.pathname === '/api/session/logout') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (state.denied && url.pathname.startsWith('/api/support/tickets/')) {
      await json(route, errorBody('RESOURCE_NOT_FOUND'), 404);
      return;
    }
    if (request.method() === 'GET') {
      state.reads.push(url.pathname + url.search);
      if (url.pathname.endsWith('/events')) {
        state.events++;
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body:
            'retry: 30000\n\nevent: resync_required\ndata: ' +
            JSON.stringify({
              ticketId: ids.ticket,
              revision: state.current.revision,
              readSequence: state.current.readSequence,
              unread: state.current.unread,
            }) +
            '\n\n',
        });
        return;
      }
      if (url.pathname.endsWith('/messages')) {
        if (url.searchParams.get('cursor') && options.stalePage) {
          await json(route, errorBody('CONFLICT'), 409);
          return;
        }
        const offset = url.searchParams.get('cursor') ? 20 : 0;
        await json(
          route,
          envelope({
            items: state.messages.slice(offset, offset + 20),
            nextCursor: state.messages.length > offset + 20 ? 'opaque-messages-page-two' : null,
          }),
        );
        return;
      }
      if (url.pathname === '/api/support/tickets') {
        await json(
          route,
          envelope({
            items: state.created ? [state.current] : [],
            nextCursor: url.searchParams.has('cursor')
              ? null
              : state.created
                ? 'opaque-tickets-page-two'
                : null,
          }),
        );
        return;
      }
      await json(route, envelope(state.current));
      return;
    }
    const body: unknown = request.postDataJSON();
    if (typeof body !== 'object' || body === null) throw new Error('Invalid synthetic command');
    const input = body as Record<string, unknown>;
    const key = request.headers()['idempotency-key'];
    state.posts.push({ path: url.pathname, key, body: input });
    if (key && state.receipts.has(key)) {
      await json(route, envelope(state.receipts.get(key)));
      return;
    }
    let result: unknown = { ticketId: ids.ticket };
    if (url.pathname === '/api/support/tickets' || url.pathname.endsWith('/messages')) {
      state.created = true;
      const next = message(state.messages.length + 1);
      next.author = 'streamer';
      next.body = String(input.body);
      state.messages.push(next);
      state.current.revision++;
      if (state.current.status === 'resolved') state.current.status = 'open';
      result = { ticketId: ids.ticket, messageId: next.id };
    } else if (url.pathname.endsWith('/read')) {
      state.current.readSequence = Number(input.sequence);
      state.current.unread = 0;
      result = { ticketId: ids.ticket, sequence: Number(input.sequence) };
    } else if (url.pathname.endsWith('/context-links')) {
      if (input.operation === 'add')
        state.current.contexts = [{ kind: 'challenge', id: ids.context }];
      else state.current.contexts = [];
      state.current.contextRevision++;
      state.current.revision++;
    }
    if (key) state.receipts.set(key, result);
    if (options.lostReply && url.pathname.endsWith('/messages') && !state.lost) {
      state.lost = true;
      await route.abort();
      return;
    }
    await json(route, envelope(result));
  });
  return state;
}
async function openThread(page: Page) {
  await page.goto(fixture(ids.ticket));
  await expect(page.getByText('Synthetic support reply 2', { exact: true })).toBeVisible();
}
test('support remains available before terms acceptance and uses creator navigation', async ({
  page,
}) => {
  const state = await scenario(page, { noTerms: true });
  await page.goto(fixture());
  await expect(page.getByRole('heading', { name: 'Support', exact: true })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Open workspace navigation', exact: true });
  if (await menu.isVisible()) await menu.click();
  await expect(
    page
      .getByRole('navigation', { name: 'Creator workspace' })
      .getByRole('link', { name: 'Support', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  expect(state.posts).toHaveLength(0);
});
test('creates a durable ticket only after an explicit plain-text form submit', async ({ page }) => {
  const state = await scenario(page, { empty: true });
  await page.goto(fixture());
  await expect(page.getByRole('heading', { name: 'No conversations on this page' })).toBeVisible();
  await page.getByRole('button', { name: 'New ticket', exact: true }).click();
  await page
    .getByLabel('Message (required)', { exact: true })
    .fill('Synthetic question <img src=x onerror=alert(1)>');
  expect(state.posts).toHaveLength(0);
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:4175/support/' + ids.ticket);
  await expect(
    page.getByText('Synthetic question <img src=x onerror=alert(1)>', { exact: true }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]?.key).toMatch(/^[a-f0-9-]{36}$/);
  await expect(page.locator('.support-messages img')).toHaveCount(0);
});
test('reads only the displayed watermark and reopens a resolved ticket on explicit reply', async ({
  page,
}) => {
  const state = await scenario(page);
  state.current.status = 'resolved';
  await openThread(page);
  await page.getByRole('button', { name: 'Mark displayed messages as read', exact: true }).click();
  await expect(
    page.getByText('Displayed messages are marked as read.', { exact: true }),
  ).toBeVisible();
  expect(state.posts[0]?.body).toEqual({ sequence: 2, notes: false });
  await page.getByLabel('Your reply (required)', { exact: true }).fill('Synthetic follow-up');
  await page.getByRole('button', { name: 'Send reply and reopen ticket', exact: true }).click();
  await expect(page.getByText('Synthetic follow-up', { exact: true })).toBeVisible();
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(2);
});
test('keeps the same key and exact body after an unknown reply without automatic writes', async ({
  page,
}) => {
  const state = await scenario(page, { lostReply: true });
  await openThread(page);
  await page.getByLabel('Your reply (required)', { exact: true }).fill('One held reply');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(page.getByText(/The result is unconfirmed/)).toBeVisible();
  expect(state.posts).toHaveLength(1);
  await page.getByRole('button', { name: 'Retry same support request', exact: true }).click();
  await expect(page.getByText('One held reply', { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(2);
  expect(state.posts[0]).toEqual(state.posts[1]);
  expect(state.messages.filter((item) => item.body === 'One held reply')).toHaveLength(1);
});
test('adds and explicitly confirms removal of owned context with a reason/revision', async ({
  page,
}) => {
  const state = await scenario(page);
  await openThread(page);
  await page.getByLabel('Resource ID (required)', { exact: true }).fill(ids.context);
  await page
    .getByLabel('Reason for context change (required)', { exact: true })
    .fill('Synthetic related challenge');
  await page.getByRole('button', { name: 'Add context', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open challenge', exact: true })).toBeVisible();
  expect(state.posts[0]?.body.expectedContextRevision).toBe(0);
  await page.getByRole('button', { name: 'Prepare removal', exact: true }).click();
  expect(state.posts).toHaveLength(1);
  await page
    .getByLabel('Reason for context change (required)', { exact: true })
    .fill('No longer relevant');
  await page.getByRole('button', { name: 'Confirm context removal', exact: true }).click();
  await expect(page.getByText('No context attached.', { exact: true })).toBeVisible();
  expect(state.posts[1]?.body).toMatchObject({
    operation: 'revoke',
    expectedContextRevision: 1,
    reason: 'No longer relevant',
  });
});
test('paginates opaque message pages and clears a draft when redacted history is refreshed', async ({
  page,
}) => {
  const state = await scenario(page, { messages: 25 });
  await openThread(page);
  await page.getByRole('button', { name: 'Next messages', exact: true }).click();
  await expect(page.getByText('Synthetic support reply 25', { exact: true })).toBeVisible();
  expect(state.reads.some((path) => path.includes('cursor=opaque-messages-page-two'))).toBe(true);
  await page.getByLabel('Your reply (required)', { exact: true }).fill('Private draft to discard');
  state.messages = state.messages.map((item) => ({ ...item, body: null, redacted: true }));
  state.current.revision++;
  await page.getByRole('button', { name: 'Refresh conversation', exact: true }).click();
  await expect(page.getByText('This message is no longer available.')).toHaveCount(20);
  await expect(page.getByLabel('Your reply (required)', { exact: true })).toHaveValue('');
  await expect(page.getByText('Synthetic support reply 25', { exact: true })).toHaveCount(0);
});
test('discards an expired cursor and refetches the current first page', async ({ page }) => {
  const state = await scenario(page, { messages: 25, stalePage: true });
  await openThread(page);
  await page.getByRole('button', { name: 'Next messages', exact: true }).click();
  await expect(page.getByText('Synthetic support reply 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous messages', exact: true })).toBeDisabled();
  expect(state.posts).toHaveLength(0);
});
test('clears inaccessible conversation content and drafts without staff data or automatic commands', async ({
  page,
}) => {
  const state = await scenario(page);
  await openThread(page);
  await page.getByLabel('Your reply (required)', { exact: true }).fill('Clear this private draft');
  state.denied = true;
  await page.getByRole('button', { name: 'Refresh conversation', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Conversation unavailable', exact: true }),
  ).toBeVisible();
  await expect(page.locator('textarea')).toHaveCount(0);
  await expect(page.getByText('Synthetic support reply 2', { exact: true })).toHaveCount(0);
  await expect(page.getByText(state.privateNote)).toHaveCount(0);
  expect(state.posts).toHaveLength(0);
});
test('supports keyboard, reduced motion, accessible labels and narrow-screen reflow', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scenario(page);
  await openThread(page);
  await page.getByLabel('Your reply (required)', { exact: true }).focus();
  await page.keyboard.type('Keyboard-only reply');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Send reply', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Keyboard-only reply', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 780 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
