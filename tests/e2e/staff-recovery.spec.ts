import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  ids,
  staffSession,
  ticket,
  envelope,
  errorBody,
  recoveryFixture,
  recoveryChallenge,
} from '../../src/services/staff-support/fixture.test-helper';
const api = 'http://127.0.0.1:3320',
  fixture = 'http://127.0.0.1:4175/tests/fixtures/staff-work.html?ticketId=' + ids.ticket;
const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4175',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'Content-Type,X-Staff-CSRF,Idempotency-Key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
async function scenario(
  page: Page,
  {
    owner = true,
    mode = 'ready',
  }: {
    owner?: boolean;
    mode?: 'ready' | 'disabled' | 'legacy' | 'expired' | 'source' | 'resolved';
  } = {},
) {
  const current = ticket();
  current.contexts = [{ kind: 'challenge', id: recoveryChallenge }];
  const recovery = recoveryFixture();
  if (mode === 'legacy') {
    recovery.fundingWindow = null;
    recovery.extension = { available: false, reasonCode: 'undisclosed_policy' };
  }
  if (mode === 'source') {
    recovery.extension = { available: false, reasonCode: 'source_unavailable' };
    recovery.continuation = { available: false, reasonCode: 'source_unavailable' };
    recovery.replacements = [];
  }
  if (mode === 'resolved') {
    recovery.extension = { available: false, reasonCode: 'resolved_ticket' };
    recovery.continuation = { available: false, reasonCode: 'resolved_ticket' };
  }
  if (mode === 'expired') {
    const old = new Date(Date.now() - 60000).toISOString();
    recovery.fundingWindow!.originalClosesAt = old;
    recovery.fundingWindow!.effectiveClosesAt = old;
    recovery.extension = { available: false, reasonCode: 'funding_closed' };
    recovery.replacements[0].observedAt = new Date(Date.now() - 40000).toISOString();
    recovery.replacements[0].validUntil = new Date(Date.now() - 10000).toISOString();
  }
  const state = {
    recovery,
    current,
    writes: [] as { body: Record<string, unknown>; key: string | undefined }[],
    reads: 0,
  };
  const json = (route: Route, value: unknown, status = 200) =>
    route.fulfill({
      status,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify(value),
    });
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
    if (req.method() === 'GET') {
      if (url.pathname.endsWith('/events')) {
        await route.fulfill({
          headers: cors,
          contentType: 'text/event-stream',
          body:
            'retry: 30000\n\nevent: heartbeat\ndata: ' +
            JSON.stringify({
              ticketId: ids.ticket,
              revision: 9,
              readSequence: 0,
              unread: 0,
              noteReadSequence: 0,
              noteUnread: 0,
            }) +
            '\n\n',
        });
        return;
      }
      if (url.pathname.includes('/recovery/')) {
        state.reads++;
        await json(
          route,
          envelope(
            mode === 'disabled'
              ? { state: 'disabled', ticketId: ids.ticket, challengeId: recoveryChallenge }
              : recovery,
          ),
        );
        return;
      }
      if (url.pathname.endsWith('/messages') || url.pathname.endsWith('/notes')) {
        await json(route, envelope({ items: [], nextCursor: null }));
        return;
      }
      await json(route, envelope(current));
      return;
    }
    const body = req.postDataJSON() as Record<string, unknown>;
    state.writes.push({ body, key: req.headers()['idempotency-key'] });
    if (url.pathname.endsWith('/extensions')) {
      const window = recovery.fundingWindow!;
      window.revision++;
      window.cumulativeSeconds += Number(body.addedSeconds);
      window.effectiveClosesAt = (body.confirmation as { newDeadline: string }).newDeadline;
      await json(route, {
        schemaVersion: 1,
        data: {
          authorizationId: ids.other,
          kind: 'extension',
          revision: window.revision,
          challengeId: recoveryChallenge,
          createdAt: new Date().toISOString(),
          authority: {
            version: 1,
            fundingWindow: window,
            performanceAuthority: recovery.performanceAuthority,
          },
        },
      });
      return;
    }
    await json(route, errorBody('NOT_FOUND'), 404);
  });
  return state;
}
for (const [mode, text] of [
  ['disabled', 'Recovery is disabled'],
  ['legacy', 'did not accept the extension disclosure'],
  ['expired', 'funding window is closed'],
  ['source', 'original challenge source is unavailable'],
  ['resolved', 'ticket is resolved'],
] as const) {
  test('synthetic recovery ' + mode + ' cannot submit an extension', async ({ page }) => {
    const state = await scenario(page, { mode });
    await page.goto(fixture);
    await expect(page.getByText(new RegExp(text)).first()).toBeVisible();
    const button = page.getByRole('button', { name: 'Confirm funding extension', exact: true });
    if (mode === 'disabled') await expect(button).toHaveCount(0);
    else await expect(button).toBeDisabled();
    expect(state.writes).toHaveLength(0);
  });
}
test('synthetic recovery confirms exact original/effective deadlines and limits, then clears consent on edit and refresh', async ({
  page,
}) => {
  const state = await scenario(page);
  await page.goto(fixture);
  const seconds = page.getByLabel('Additional funding seconds'),
    reason = page.getByLabel('Extension reason'),
    confirmation = page.getByRole('checkbox', { name: /I reviewed this exact challenge/ }),
    submit = page.getByRole('button', { name: 'Confirm funding extension', exact: true });
  await seconds.fill('121');
  await reason.fill('Reviewed outage.');
  await expect(confirmation).toBeDisabled();
  await seconds.fill('60');
  await confirmation.check();
  await reason.fill('Changed reviewed reason.');
  await expect(confirmation).not.toBeChecked();
  await expect(submit).toBeDisabled();
  await confirmation.check();
  await submit.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].body).toMatchObject({
    addedSeconds: 60,
    expectedWindowRevision: 0,
    expectedTicketRevision: 9,
    reason: 'Changed reviewed reason.',
  });
  expect(state.writes[0].key).toBeTruthy();
  await expect(confirmation).not.toBeChecked();
  await page.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
  await expect(seconds).toHaveValue('');
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.map((value) => value.id)).toEqual([]);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
test('synthetic continuation rejects expired verified evidence and never accepts a manually invented broadcast', async ({
  page,
}) => {
  const state = await scenario(page, { mode: 'expired' });
  await page.goto(fixture);
  await page.getByLabel('Verified replacement stream').selectOption(ids.other);
  await page.getByLabel('Continuation reason').fill('Reviewed replacement.');
  await expect(page.getByText(/Evidence expired/)).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: /I reviewed this challenge, immutable original/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Confirm performance continuation', exact: true }),
  ).toBeDisabled();
  expect(state.writes).toHaveLength(0);
});
test('synthetic Support has no recovery controls or recovery network reads', async ({ page }) => {
  const state = await scenario(page, { owner: false });
  await page.goto(fixture);
  await expect(
    page.getByRole('heading', { name: 'Ticket ' + ids.ticket.slice(0, 8), exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Audited recovery', exact: true })).toHaveCount(0);
  expect(state.reads).toBe(0);
});
