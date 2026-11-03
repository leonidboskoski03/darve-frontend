import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  ids,
  staffSession,
  ticket,
  queue,
  message,
  envelope,
  errorBody,
} from '../../src/services/staff-support/fixture.test-helper';
const api = 'http://127.0.0.1:3320',
  fixture = (thread = false) =>
    'http://127.0.0.1:4175/tests/fixtures/staff-work.html' +
    (thread ? '?ticketId=' + ids.ticket : '');
const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4175',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'Content-Type,X-Staff-CSRF,Idempotency-Key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    headers: cors,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
async function scenario(
  page: Page,
  { owner = false, lost = false, lostStatus = false, denied = false } = {},
) {
  const messages: ReturnType<typeof message>[] = [
    { ...message(), author: 'streamer', body: 'Synthetic creator question' },
  ];
  const notes: ReturnType<typeof message>[] = [{ ...message(), body: 'Synthetic private note' }];
  const state = {
    current: ticket(),
    available: false,
    availabilityRevision: 0,
    messages,
    notes,
    writes: [] as { path: string; key: string | undefined; body: Record<string, unknown> }[],
    reads: [] as string[],
    receipts: new Map<string, unknown>(),
    lost: false,
    denied,
  };
  await page.route(api + '/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (url.pathname === '/admin/v1/session') {
      await json(route, envelope(staffSession(owner)));
      return;
    }
    if (url.pathname.endsWith('/auth/email-code')) {
      await json(route, errorBody(), 401);
      return;
    }
    if (state.denied && url.pathname.startsWith('/admin/v1/support/tickets/')) {
      await json(route, errorBody('NOT_FOUND'), 404);
      return;
    }
    if (req.method() === 'GET') {
      state.reads.push(url.pathname + url.search);
      if (url.pathname.endsWith('/events')) {
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body:
            'retry: 30000\n\nevent: resync_required\ndata: ' +
            JSON.stringify({
              ticketId: ids.ticket,
              revision: state.current.staffRevision,
              readSequence: state.current.readSequence,
              unread: state.current.unread,
              noteReadSequence: state.current.noteReadSequence,
              noteUnread: state.current.noteUnread,
            }) +
            '\n\n',
        });
        return;
      }
      if (url.pathname.endsWith('/availability'))
        await json(
          route,
          envelope({ available: state.available, revision: state.availabilityRevision }),
        );
      else if (url.pathname.endsWith('/queue'))
        await json(route, envelope({ items: [queue()], nextCursor: null }));
      else if (url.pathname.endsWith('/tickets'))
        await json(route, envelope({ items: [state.current], nextCursor: null }));
      else if (url.pathname.endsWith('/messages') || url.pathname.endsWith('/notes'))
        await json(
          route,
          envelope({
            items: url.pathname.endsWith('/notes') ? state.notes : state.messages,
            nextCursor: null,
          }),
        );
      else await json(route, envelope(state.current));
      return;
    }
    const body: unknown = req.postDataJSON();
    if (typeof body !== 'object' || !body) throw Error('Invalid synthetic body');
    const input = body as Record<string, unknown>,
      key = req.headers()['idempotency-key'];
    state.writes.push({ path: url.pathname, key, body: input });
    if (key && state.receipts.has(key)) {
      await json(route, envelope(state.receipts.get(key)));
      return;
    }
    let result: unknown = { ticketId: ids.ticket };
    if (url.pathname.endsWith('/availability')) {
      state.available = Boolean(input.available);
      state.availabilityRevision++;
      result = { available: state.available, revision: state.availabilityRevision };
    } else if (url.pathname.endsWith('/claims')) {
      state.current.assigneeId = ids.agent;
      state.current.authorityRevision++;
    } else if (url.pathname.endsWith('/messages') || url.pathname.endsWith('/notes')) {
      const notes = url.pathname.endsWith('/notes'),
        collection = notes ? state.notes : state.messages;
      const added = { ...message(collection.length + 1), body: String(input.body) };
      collection.push(added);
      state.current.staffRevision++;
      if (!notes) state.current.revision++;
      result = { ticketId: ids.ticket, messageId: added.id };
    } else if (url.pathname.endsWith('/read')) {
      if (input.notes) {
        state.current.noteReadSequence = Number(input.sequence);
        state.current.noteUnread = 0;
      } else {
        state.current.readSequence = Number(input.sequence);
        state.current.unread = 0;
      }
      result = { ticketId: ids.ticket, sequence: Number(input.sequence) };
    } else if (url.pathname.endsWith('/status')) {
      state.current.status = input.status as ReturnType<typeof ticket>['status'];
      state.current.revision++;
      state.current.staffRevision++;
    } else if (url.pathname.endsWith('/reassignments')) {
      state.current.assigneeId = String(input.assigneeId);
      state.current.authorityRevision++;
      state.current.staffRevision++;
    }
    if (key) state.receipts.set(key, result);
    if (
      ((lost && url.pathname.endsWith('/messages')) ||
        (lostStatus && url.pathname.endsWith('/status'))) &&
      !state.lost
    ) {
      state.lost = true;
      await route.abort();
      return;
    }
    await json(route, envelope(result));
  });
  return state;
}
async function open(page: Page) {
  await page.goto(fixture(true));
  await expect(page.getByText('Synthetic creator question', { exact: true })).toBeVisible();
}
test('sign-in never opts into availability and an unavailable Support cannot preload the queue', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(fixture());
  await expect(page.getByText('Not available for new tickets', { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Unassigned queue', exact: true }).click();
  await expect(
    page.getByText('Become available before reading or claiming the unassigned queue.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(state.reads.some((path) => path.includes('/queue'))).toBe(false);
});
test('availability opt-in and reviewed queue claim use current revisions without private preloading', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(fixture());
  await page.getByRole('button', { name: 'Become available for tickets', exact: true }).click();
  await expect(page.getByText('Available for new tickets', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unassigned queue', exact: true }).click();
  await page.getByRole('button', { name: 'Review claim', exact: true }).click();
  expect(state.reads.some((path) => path.startsWith('/admin/v1/support/tickets/'))).toBe(false);
  await page
    .getByLabel('Claim reason (required)', { exact: true })
    .fill('Reviewed queue assignment');
  await page.getByRole('button', { name: 'Confirm ticket claim', exact: true }).click();
  await expect(page.getByText('Synthetic creator question', { exact: true })).toBeVisible();
  expect(state.writes[1]?.body).toEqual({
    reason: 'Reviewed queue assignment',
    expectedAuthorityRevision: 5,
  });
});
test('keeps conversation and internal note text, writes and read marks separate', async ({
  page,
}) => {
  const state = await scenario(page);
  await open(page);
  await expect(page.getByText('Synthetic private note', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Internal notes \(/ }).click();
  await expect(page.getByText('Synthetic private note', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic creator question', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark displayed notes as read', exact: true }).click();
  await expect(page.getByText('Displayed notes marked as read.', { exact: true })).toBeVisible();
  expect(state.writes[0]?.body).toEqual({ sequence: 1, notes: true });
  await page.getByLabel('Internal note (required)', { exact: true }).fill('Another internal note');
  await page.getByRole('button', { name: 'Save internal note', exact: true }).click();
  await expect(
    page.locator('.staff-work-messages').getByText('Another internal note', { exact: true }),
  ).toBeVisible();
  expect(state.writes[1]?.path.endsWith('/notes')).toBe(true);
  expect(state.writes[1]?.body).toEqual({
    body: 'Another internal note',
    expectedAuthorityRevision: 5,
  });
});
test('does not repeat a lost reply and explicitly retries the exact held staff request', async ({
  page,
}) => {
  const state = await scenario(page, { lost: true });
  await open(page);
  await page
    .getByLabel('Creator reply (required)', { exact: true })
    .fill('One synthetic public reply');
  await page.getByRole('button', { name: 'Send creator reply', exact: true }).click();
  await expect(page.getByText(/The result is unconfirmed/)).toBeVisible();
  expect(state.writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Retry same staff request', exact: true }).click();
  await expect(
    page.locator('.staff-work-messages').getByText('One synthetic public reply', { exact: true }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(state.writes[0]).toEqual(state.writes[1]);
  expect(state.messages).toHaveLength(2);
});
test('requires reviewed status change and preserves its uncertain request across refresh', async ({
  page,
}) => {
  const state = await scenario(page, { lostStatus: true });
  await open(page);
  await page.getByLabel('New ticket status', { exact: true }).selectOption('resolved');
  await page.getByLabel('Status reason (required)', { exact: true }).fill('Issue answered');
  await expect(
    page.getByRole('button', { name: 'Confirm status change', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('checkbox', {
      name: 'I reviewed this status change and any creator-visible reply.',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Confirm status change', exact: true }).click();
  await expect(page.getByText(/The result is unconfirmed/)).toBeVisible();
  await page.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
  await expect(
    page.getByText('This ticket is resolved. A creator reply can reopen it.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Retry same staff request', exact: true }).click();
  await expect(page.getByText(/The server recorded this request/)).toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(state.writes[0]).toEqual(state.writes[1]);
  expect(state.writes[0]?.body).toMatchObject({
    status: 'resolved',
    expectedRevision: 2,
    expectedAuthorityRevision: 5,
    reason: 'Issue answered',
  });
});
test('Support cannot see reassignment while owner administrator confirms the exact target', async ({
  page,
}) => {
  const state = await scenario(page, { owner: true });
  await open(page);
  await page.getByLabel('Target staff ID (required)', { exact: true }).fill(ids.other);
  await page
    .getByLabel('Reassignment reason (required)', { exact: true })
    .fill('Reviewed available target');
  await expect(
    page.getByRole('button', { name: 'Confirm reassignment', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('checkbox', {
      name: 'I reviewed the exact target staff ID and reassignment reason.',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Confirm reassignment', exact: true }).click();
  await expect(page.getByText('Assignment: ' + ids.other, { exact: true })).toBeVisible();
  expect(state.writes[0]?.body).toMatchObject({
    assigneeId: ids.other,
    expectedAuthorityRevision: 5,
  });
});
test('clears private notes and drafts when ticket access is lost', async ({ page }) => {
  const state = await scenario(page);
  await open(page);
  await expect(page.getByRole('heading', { name: 'Reassign ticket', exact: true })).toHaveCount(0);
  await page
    .getByLabel('Creator reply (required)', { exact: true })
    .fill('Private discarded draft');
  state.denied = true;
  await page.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Support desk', exact: true })).toBeVisible();
  await expect(page.locator('textarea')).toHaveCount(0);
  await expect(page.getByText('Synthetic creator question', { exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});
test('retains authoritative redaction and clears mounted drafts on refresh', async ({ page }) => {
  const state = await scenario(page);
  await open(page);
  await page.getByLabel('Creator reply (required)', { exact: true }).fill('Old private draft');
  state.messages = state.messages.map((item) => ({
    ...item,
    body: null,
    redacted: true,
  }));
  state.current.staffRevision++;
  await page.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
  await expect(
    page.getByText('This message is no longer available.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Creator reply (required)', { exact: true })).toHaveValue('');
});
test('supports keyboard submission, reduced motion, axe and 320px reflow', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scenario(page);
  await open(page);
  await page.getByLabel('Creator reply (required)', { exact: true }).focus();
  await page.keyboard.type('Keyboard public response');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Send creator reply', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.locator('.staff-work-messages').getByText('Keyboard public response', { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 780 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
