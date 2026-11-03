import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { build, preview } from 'vite';
import { chromium, devices, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startLocalApi } from './local-api.mjs';

// Explicit F08-08 only: real public/staff entries and HTTP/SQL/Redis, controlled identity/source setup.
const evidence = resolve('artifacts.local/f08-08');
mkdirSync(evidence, { recursive: true });
const origin = 'http://127.0.0.1:4175',
  front = 'http://localhost:4176',
  admin = 'http://localhost:3320';
const fingerprint = () =>
  Object.fromEntries(
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8',
      windowsHide: true,
    })
      .split('\0')
      .filter(
        (file) =>
          file &&
          ((/^(src|public)\//.test(file) &&
            !/(?:\.test|\.test-helper|\.test-support)\./.test(file) &&
            !file.startsWith('src/app/preview/')) ||
            /^(?:index\.html|staff\.html|overlay\.html|vite(?:\.staff)?\.config\.ts|package(?:-lock)?\.json|tsconfig[^/]*\.json|tools\/local-(?:api|support-fixture|staff-admin-seed|staff-combined-acceptance)\.mjs)$/.test(
              file,
            )),
      )
      .sort()
      .map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
  );
const sourceInputs = fingerprint(),
  checks = [],
  errors = [],
  network = {
    publicStaffCookie: false,
    publicCreatorCookie: false,
    adminStaffCookie: false,
    adminCreatorCookie: false,
    privateReferrer: false,
    publicSawNote: false,
    publicSawStaffFields: false,
  };
let api,
  browser,
  publicSite,
  staffSite,
  server,
  observed,
  phase = 'setup',
  ticketId,
  staffPages = [],
  rateRemaining = 120,
  rateResetAt = 0,
  admissionPauses = 0;
const check = async (name, fn) => {
  phase = name;
  if (rateRemaining < 45) {
    const destinations = staffPages.map((page) => page.url());
    await Promise.all(staffPages.map((page) => page.goto('about:blank')));
    const until = rateResetAt + 1000;
    console.log(JSON.stringify({ phase: name, waitingForSharedLoopbackRateWindow: true }));
    while (Date.now() < until)
      await new Promise((done) => setTimeout(done, Math.min(30000, until - Date.now())));
    rateRemaining = 120;
    rateResetAt = 0;
    admissionPauses++;
    await Promise.all(staffPages.map((page, index) => page.goto(destinations[index])));
  }
  const start = performance.now();
  await fn();
  checks.push({ name, passed: true, durationMs: Math.round(performance.now() - start) });
  console.log(JSON.stringify({ check: name, passed: true }));
};
const closeServer = (server) =>
  new Promise((done) => {
    server.close(done);
    server.closeAllConnections();
  });
try {
  api = await startLocalApi({
    backend: process.argv[2] ?? '../tmp/backend-f06-checkout',
    origins: [origin],
    task: 'f08-08',
    support: true,
  });
  const creator = await api.seedSession({ expiresInMs: 900000 });
  const inspection = await api.seedStaffInspection(creator, {
    disclosed: true,
    readProjection: true,
    evidenceDirectory: evidence,
  });
  const runtime = await api.createStaffWorkbench();
  server = createServer((request, response) => {
    network.adminCreatorCookie ||= (request.headers.cookie ?? '').includes('darve_session=');
    network.adminStaffCookie ||= (request.headers.cookie ?? '').includes(
      'darve_staff_dev_session=',
    );
    network.privateReferrer ||= Boolean(request.headers.referer);
    response.on('finish', () => {
      const value = String(response.getHeader('ratelimit') ?? ''),
        remaining = /\br=(\d+)/.exec(value),
        reset = /\bt=(\d+)/.exec(value);
      if (remaining) rateRemaining = Math.min(rateRemaining, Number(remaining[1]));
      if (reset) rateResetAt = Math.max(rateResetAt, Date.now() + Number(reset[1]) * 1000);
    });
    runtime.app(request, response);
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(3320, 'localhost', done);
  });
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  const publicModules = new Set(),
    staffModules = new Set();
  const captureModules = (set) => ({
    name: 'combined-entry-authority-proof',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle))
        if (chunk.type === 'chunk')
          for (const id of chunk.moduleIds) set.add(id.replaceAll('\\', '/'));
    },
  });
  await build({
    configFile: 'vite.config.ts',
    envDir: false,
    mode: 'combined-public-acceptance',
    logLevel: 'silent',
    build: { outDir: join(evidence, 'public-build'), emptyOutDir: true },
    plugins: [captureModules(publicModules)],
  });
  publicSite = await preview({
    configFile: 'vite.config.ts',
    envDir: false,
    mode: 'combined-public-acceptance',
    logLevel: 'silent',
    build: { outDir: join(evidence, 'public-build') },
    preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  });
  process.env.STAFF_PUBLIC_APP_ENV = 'local';
  process.env.STAFF_PUBLIC_API_ORIGIN = admin;
  process.env.STAFF_PUBLIC_AUTHORIZATION_ENDPOINT = 'http://localhost:3321/authorize';
  await build({
    configFile: 'vite.staff.config.ts',
    envDir: false,
    mode: 'combined-staff-acceptance',
    logLevel: 'silent',
    build: { outDir: join(evidence, 'staff-build'), emptyOutDir: true },
    plugins: [captureModules(staffModules)],
  });
  staffSite = await preview({
    configFile: 'vite.staff.config.ts',
    envDir: false,
    mode: 'combined-staff-acceptance',
    logLevel: 'silent',
    build: { outDir: join(evidence, 'staff-build') },
    preview: { host: 'localhost', port: 4176, strictPort: true },
  });
  assert(
    [...publicModules].every(
      (id) =>
        !/\/src\/(?:features\/(?:staff-access|staff-support|staff-admin)|services\/(?:staff-access|staff-support|staff-admin))\//.test(
          id,
        ),
    ),
  );
  assert(
    [...staffModules].every(
      (id) =>
        !/\/src\/(?:features\/(?:creator-access|support|contributions|overlay-display)|services\/(?:creator-session|support))\//.test(
          id,
        ),
    ),
  );
  browser = await chromium.launch();
  const creatorContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await creatorContext.addCookies([
    {
      name: 'darve_session',
      value: creator.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const owner = await runtime.seed('OWNER_ADMIN'),
    first = await runtime.seed(),
    second = await runtime.seed();
  const staffContext = async (identity, options = {}) => {
    const context = await browser.newContext(options);
    await context.addCookies([
      {
        name: 'darve_staff_dev_session',
        value: identity.secret,
        url: admin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    return context;
  };
  const ownerContext = await staffContext(owner, { viewport: { width: 1440, height: 1000 } }),
    one = await staffContext(first, { viewport: { width: 1440, height: 1000 } }),
    two = await staffContext(second, devices['Pixel 7']);
  // Deliberately hold both host-scoped cookies in a context to verify hostname separation.
  await creatorContext.addCookies([
    {
      name: 'darve_staff_dev_session',
      value: owner.secret,
      url: admin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await ownerContext.addCookies([
    {
      name: 'darve_session',
      value: creator.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const creatorPage = await creatorContext.newPage(),
    ownerPage = await ownerContext.newPage(),
    a = await one.newPage(),
    b = await two.newPage();
  staffPages = [ownerPage, a, b];
  observed = creatorPage;
  for (const page of [creatorPage, ownerPage, a, b])
    page.on('pageerror', (error) => errors.push(error.name));
  creatorPage.on('request', async (request) => {
    if (new URL(request.url()).origin !== api.apiOrigin) return;
    const headers = await request.allHeaders();
    network.publicStaffCookie ||= (headers.cookie ?? '').includes('darve_staff_');
    network.publicCreatorCookie ||= (headers.cookie ?? '').includes('darve_session=');
    network.privateReferrer ||= Boolean(headers.referer);
  });
  creatorPage.on('response', async (response) => {
    if (
      new URL(response.url()).origin !== api.apiOrigin ||
      !new URL(response.url()).pathname.startsWith('/api/support/') ||
      !response.headers()['content-type']?.includes('application/json')
    )
      return;
    try {
      const body = await response.text();
      network.publicSawNote ||= body.includes('Synthetic internal-only combined note.');
      network.publicSawStaffFields ||=
        /"(?:assigneeId|staffRevision|noteUnread|noteReadSequence|authorityRevision)":/.test(body);
    } catch {
      /* A cancelled private read cannot establish content. */
    }
  });
  const get = async (context, url, status = 200) => {
    const response = await context.request.get(url);
    assert.equal(response.status(), status);
    return response.json();
  };
  const detail = (context) =>
    get(context, admin + '/admin/v1/support/tickets/' + ticketId).then((value) => value.data);
  const publicDetail = () =>
    get(creatorContext, api.apiOrigin + '/api/support/tickets/' + ticketId).then(
      (value) => value.data,
    );
  const command = async (
    context,
    identity,
    suffix,
    body,
    { key = randomUUID(), status = 200 } = {},
  ) => {
    const response = await context.request.post(
      admin + '/admin/v1/support/tickets/' + ticketId + suffix,
      {
        headers: { Origin: front, 'x-staff-csrf': identity.csrf, 'Idempotency-Key': key },
        data: body,
      },
    );
    assert.equal(response.status(), status);
    return response.json();
  };
  let winner, loser, winnerContext, loserContext, winnerIdentity, loserIdentity;
  await check(
    'creator creates and links one owned challenge through production UI; separate staff entries have no private preload',
    async () => {
      await creatorPage.goto(origin + '/support');
      await creatorPage.getByRole('button', { name: 'New ticket', exact: true }).click();
      await creatorPage.getByLabel('Category', { exact: true }).selectOption('challenge');
      await creatorPage
        .getByLabel('Message (required)', { exact: true })
        .fill('Synthetic combined creator request.');
      await creatorPage.getByRole('button', { name: 'Create ticket', exact: true }).click();
      await expect(creatorPage).toHaveURL(/\/support\/[0-9a-f-]{36}$/i);
      ticketId = new URL(creatorPage.url()).pathname.split('/').at(-1);
      await creatorPage.getByLabel('Resource ID').fill(inspection.id);
      await creatorPage
        .getByLabel('Reason for context change')
        .fill('Review this owned challenge.');
      await creatorPage.getByRole('button', { name: 'Add context', exact: true }).click();
      await expect(
        creatorPage.getByRole('button', { name: 'Open challenge', exact: true }),
      ).toBeVisible();
      assert.equal((await publicDetail()).contexts[0].id, inspection.id);
      await Promise.all([a.goto(front + '/tickets'), b.goto(front + '/tickets')]);
      for (const page of [a, b]) {
        await expect(
          page.getByText('Not available for new tickets', { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText('Synthetic combined creator request.', { exact: true }),
        ).toHaveCount(0);
        await page
          .getByRole('button', { name: 'Become available for tickets', exact: true })
          .click();
        await page.getByRole('button', { name: 'Unassigned queue', exact: true }).click();
        await page.getByRole('button', { name: 'Review claim', exact: true }).click();
        await page
          .getByLabel('Claim reason (required)', { exact: true })
          .fill('Reviewed combined claim race.');
      }
    },
  );
  await check(
    'concurrent Support claim has one winner and current ticket-context inspection follows only that assignment',
    async () => {
      await Promise.all([
        a.getByRole('button', { name: 'Confirm ticket claim', exact: true }).click(),
        b.getByRole('button', { name: 'Confirm ticket claim', exact: true }).click(),
      ]);
      await expect
        .poll(
          () =>
            [a, b].filter((page) => new URL(page.url()).pathname === '/tickets/' + ticketId).length,
        )
        .toBe(1);
      winner = a.url().endsWith(ticketId) ? a : b;
      loser = winner === a ? b : a;
      winnerContext = winner === a ? one : two;
      loserContext = winner === a ? two : one;
      winnerIdentity = winner === a ? first : second;
      loserIdentity = winner === a ? second : first;
      observed = winner;
      await expect(
        winner.getByText('Synthetic combined creator request.', { exact: true }),
      ).toBeVisible();
      await expect(loser.locator('.staff-work-messages')).toHaveCount(0);
      await get(winnerContext, admin + '/admin/v1/challenges/' + inspection.id);
      await get(loserContext, admin + '/admin/v1/challenges/' + inspection.id, 404);
      await expect(
        winner.getByRole('heading', { name: 'Audited recovery', exact: true }),
      ).toHaveCount(0);
    },
  );
  await check(
    'internal notes and staff read positions never alter creator transcript or public revision across simultaneous live entries',
    async () => {
      const before = await publicDetail();
      await winner.getByRole('button', { name: /Internal notes \(/ }).click();
      await winner
        .getByLabel('Internal note (required)', { exact: true })
        .fill('Synthetic internal-only combined note.');
      await winner.getByRole('button', { name: 'Save internal note', exact: true }).click();
      await expect(
        winner
          .locator('.staff-work-messages')
          .getByText('Synthetic internal-only combined note.', { exact: true }),
      ).toBeVisible();
      await winner
        .getByRole('button', { name: 'Mark displayed notes as read', exact: true })
        .click();
      await expect(
        winner.getByText('Displayed notes marked as read.', { exact: true }),
      ).toBeVisible();
      await creatorPage.getByRole('button', { name: 'Refresh conversation', exact: true }).click();
      await expect(
        creatorPage.getByText('Synthetic combined creator request.', { exact: true }),
      ).toBeVisible();
      assert.deepEqual(await publicDetail(), before);
      await expect(
        creatorPage.getByText('Synthetic internal-only combined note.', { exact: true }),
      ).toHaveCount(0);
      await api.supportFixture.assertPrivateIsolation(ticketId);
    },
  );
  await check(
    'lost executed staff reply appears once to the creator while staff deliberately reconciles the identical held request',
    async () => {
      await winner.getByRole('button', { name: /Creator conversation \(/ }).click();
      const url = admin + '/admin/v1/support/tickets/' + ticketId + '/messages',
        requests = [];
      let lost = false;
      await winner.route(url, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        requests.push({
          body: route.request().postData(),
          key: route.request().headers()['idempotency-key'],
        });
        if (!lost) {
          lost = true;
          assert.equal((await route.fetch()).status(), 200);
          await route.abort();
        } else await route.continue();
      });
      await winner
        .getByLabel('Creator reply (required)', { exact: true })
        .fill('Synthetic combined public answer.');
      await winner.getByRole('button', { name: 'Send creator reply', exact: true }).click();
      await expect(winner.getByText(/The result is unconfirmed/)).toBeVisible();
      await expect(
        creatorPage
          .locator('.support-messages')
          .getByText('Synthetic combined public answer.', { exact: true }),
      ).toHaveCount(1, { timeout: 10000 });
      await winner.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
      await winner.getByRole('button', { name: 'Retry same staff request', exact: true }).click();
      await expect(winner.getByText(/The server recorded this request/)).toBeVisible();
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[0], requests[1]);
      assert.equal((await api.supportFixture.counts(ticketId)).messages, 2);
      await winner.unroute(url);
    },
  );
  await check(
    'owner reassigns while former staff holds a draft; stale assigned command is denied and both creator history and new access remain correct',
    async () => {
      const old = await detail(winnerContext);
      await winner
        .getByLabel('Creator reply (required)', { exact: true })
        .fill('Discard former-assignee draft.');
      await ownerPage.goto(front + '/tickets/' + ticketId);
      observed = ownerPage;
      await ownerPage
        .getByLabel('Target staff ID (required)', { exact: true })
        .fill(loserIdentity.id);
      await ownerPage
        .getByLabel('Reassignment reason (required)', { exact: true })
        .fill('Reviewed combined transfer.');
      await ownerPage
        .getByRole('checkbox', {
          name: 'I reviewed the exact target staff ID and reassignment reason.',
          exact: true,
        })
        .check();
      await ownerPage.getByRole('button', { name: 'Confirm reassignment', exact: true }).click();
      await expect(
        ownerPage.getByText('Assignment: ' + loserIdentity.id, { exact: true }),
      ).toBeVisible();
      await expect(winner.getByRole('heading', { name: 'Support desk', exact: true })).toBeVisible({
        timeout: 10000,
      });
      await expect(winner.locator('textarea')).toHaveCount(0);
      await command(
        winnerContext,
        winnerIdentity,
        '/messages',
        {
          body: 'Stale former-assignee write.',
          expectedRevision: old.revision,
          expectedAuthorityRevision: old.authorityRevision,
        },
        { status: 404 },
      );
      await get(winnerContext, admin + '/admin/v1/challenges/' + inspection.id, 404);
      await loser.goto(front + '/tickets/' + ticketId);
      await expect(
        loser.getByText('Synthetic combined public answer.', { exact: true }),
      ).toBeVisible();
      await get(loserContext, admin + '/admin/v1/challenges/' + inspection.id);
      assert.equal((await api.supportFixture.counts(ticketId)).messages, 2);
      await expect(
        creatorPage
          .locator('.support-messages')
          .getByText('Synthetic combined public answer.', { exact: true }),
      ).toHaveCount(1);
    },
  );
  await check(
    'owner extension reconciles canonical authority; creator context removal invalidates prepared recovery and clears its mounted confirmation',
    async () => {
      await ownerPage.getByLabel('Additional funding seconds').fill('60');
      await ownerPage.getByLabel('Extension reason').fill('Reviewed combined recovery.');
      await ownerPage.getByRole('checkbox', { name: /I reviewed this exact challenge/ }).check();
      await ownerPage
        .getByRole('button', { name: 'Confirm funding extension', exact: true })
        .click();
      await expect(ownerPage.getByText(/The server recorded this request/)).toBeVisible();
      const contextUrl =
        admin + '/admin/v1/support/tickets/' + ticketId + '/recovery/' + inspection.id;
      const c = (await get(ownerContext, contextUrl)).data;
      assert.equal(c.fundingWindow.cumulativeSeconds, 60);
      assert.equal((await runtime.recoveryEvidence(inspection.id)).actions.length, 1);
      await ownerPage.getByLabel('Additional funding seconds').fill('30');
      await ownerPage.getByLabel('Extension reason').fill('Must clear after context removal.');
      await ownerPage.getByRole('checkbox', { name: /I reviewed this exact challenge/ }).check();
      await creatorPage.getByRole('button', { name: 'Prepare removal', exact: true }).click();
      await creatorPage
        .getByLabel('Reason for context change')
        .fill('Remove this challenge context.');
      await creatorPage
        .getByRole('button', { name: 'Confirm context removal', exact: true })
        .click();
      await expect(creatorPage.getByText('No context attached.', { exact: true })).toBeVisible();
      await expect(ownerPage.getByText(/No challenge is linked to this ticket/)).toBeVisible({
        timeout: 10000,
      });
      await expect(ownerPage.getByLabel('Extension reason')).toHaveCount(0);
      await get(ownerContext, contextUrl, 404);
      const stale = {
        challengeId: c.challengeId,
        expectedTicketRevision: c.ticketRevision,
        expectedContextRevision: c.contextRevision,
        expectedAuthorityRevision: c.authorityRevision,
        expectedFundingRevision: c.fundingRevision,
        expectedPerformanceRevision: c.performanceRevision,
        expectedWindowRevision: c.fundingWindow.revision,
        addedSeconds: 30,
        reason: 'Stale removed context.',
        confirmation: {
          challengeId: c.challengeId,
          previousDeadline: c.fundingWindow.effectiveClosesAt,
          newDeadline: new Date(
            Date.parse(c.fundingWindow.effectiveClosesAt) + 30000,
          ).toISOString(),
        },
      };
      const denied = await ownerContext.request.post(
        admin + '/admin/v1/support/tickets/' + ticketId + '/extensions',
        {
          headers: { Origin: front, 'x-staff-csrf': owner.csrf, 'Idempotency-Key': randomUUID() },
          data: stale,
        },
      );
      assert([404, 409].includes(denied.status()));
      assert.equal((await runtime.recoveryEvidence(inspection.id)).actions.length, 1);
    },
  );
  await check(
    'creator reopening releases the old assignment; Support deliberately reclaims the same persisted conversation',
    async () => {
      await ownerPage.getByLabel('New ticket status', { exact: true }).selectOption('resolved');
      await ownerPage
        .getByLabel('Status reason (required)', { exact: true })
        .fill('Reviewed combined resolution.');
      await ownerPage
        .getByRole('checkbox', {
          name: 'I reviewed this status change and any creator-visible reply.',
          exact: true,
        })
        .check();
      await ownerPage.getByRole('button', { name: 'Confirm status change', exact: true }).click();
      await expect(
        creatorPage.getByRole('button', { name: 'Send reply and reopen ticket', exact: true }),
      ).toBeVisible({ timeout: 10000 });
      await creatorPage
        .getByLabel('Your reply (required)', { exact: true })
        .fill('Synthetic combined reopen question.');
      await creatorPage
        .getByRole('button', { name: 'Send reply and reopen ticket', exact: true })
        .click();
      await expect(loser.getByRole('heading', { name: 'Support desk', exact: true })).toBeVisible({
        timeout: 10000,
      });
      await expect(loser.locator('.staff-work-messages')).toHaveCount(0);
      await expect(
        ownerPage
          .locator('.staff-work-messages')
          .getByText('Synthetic combined reopen question.', { exact: true }),
      ).toBeVisible({ timeout: 10000 });
      assert.equal((await publicDetail()).status, 'open');
      assert.equal(new URL(creatorPage.url()).pathname, '/support/' + ticketId);
      await loser.getByRole('button', { name: 'Unassigned queue', exact: true }).click();
      await loser.getByRole('button', { name: 'Refresh desk', exact: true }).click();
      await loser.getByRole('button', { name: 'Review claim', exact: true }).click();
      await loser
        .getByLabel('Claim reason (required)', { exact: true })
        .fill('Reviewed reopened conversation.');
      await loser.getByRole('button', { name: 'Confirm ticket claim', exact: true }).click();
      await expect(
        loser
          .locator('.staff-work-messages')
          .getByText('Synthetic combined reopen question.', { exact: true }),
      ).toBeVisible();
    },
  );
  await check(
    'desktop and narrow creator/staff entries retain keyboard labels, accessible states and no cross-authority content leakage',
    async () => {
      for (const [page, label] of [
        [creatorPage, 'creator'],
        [ownerPage, 'owner'],
        [loser, 'support'],
      ]) {
        observed = page;
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const violations = (await new AxeBuilder({ page }).analyze()).violations;
        assert.deepEqual(
          violations.map((v) => v.id),
          [],
        );
        await page.setViewportSize({ width: 320, height: 1000 });
        assert.equal(
          await page.evaluate(
            () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
          ),
          false,
        );
        await page.screenshot({
          path: join(evidence, 'synthetic-combined-' + label + '-320.png'),
          fullPage: true,
        });
      }
      assert.deepEqual(network, {
        publicStaffCookie: false,
        publicCreatorCookie: true,
        adminStaffCookie: true,
        adminCreatorCookie: false,
        privateReferrer: false,
        publicSawNote: false,
        publicSawStaffFields: false,
      });
    },
  );
  await check(
    'owner revokes the current assignee; staff history and drafts disappear while creator conversation and other authority remain active',
    async () => {
      await loser
        .getByLabel('Creator reply (required)', { exact: true })
        .fill('Discard revoked staff draft.');
      await ownerPage.goto(front + '/reviews?view=staff');
      observed = ownerPage;
      const row = ownerPage
          .locator('.staff-admin-records>li')
          .filter({ hasText: loserIdentity.id }),
        form = row.getByRole('form', { name: 'Revoke staff membership', exact: true });
      await form
        .getByLabel('Revoke staff membership reason (required)', { exact: true })
        .fill('Reviewed combined revocation.');
      await form.getByRole('checkbox').check();
      await form.getByRole('button', { name: 'Confirm staff revocation', exact: true }).click();
      await expect(row.getByText('This membership is inactive.', { exact: true })).toBeVisible();
      await loser.reload();
      await expect(
        loser.getByRole('heading', {
          name: /^(Your staff access expired|Sign in to Darve staff)$/,
        }),
      ).toBeVisible();
      await expect(loser.locator('.staff-work-messages')).toHaveCount(0);
      await expect(loser.getByLabel('Creator reply (required)', { exact: true })).toHaveCount(0);
      await get(loserContext, admin + '/admin/v1/support/tickets/' + ticketId, 401);
      await creatorPage.reload();
      await expect(
        creatorPage.getByText('Synthetic combined reopen question.', { exact: true }),
      ).toBeVisible();
      assert.equal(
        (await get(ownerContext, admin + '/admin/v1/session')).data.state,
        'authenticated',
      );
      assert.equal((await runtime.evidence(loserIdentity.id)).principal.active, false);
    },
  );
  await check(
    'creator revocation clears its private entry without affecting the independent owner session',
    async () => {
      await creatorPage
        .getByLabel('Your reply (required)', { exact: true })
        .fill('Discard revoked creator draft.');
      await api.supportFixture.revoke(creator.sessionId);
      await creatorPage.reload();
      await expect(
        creatorPage.getByText('Synthetic combined reopen question.', { exact: true }),
      ).toHaveCount(0);
      await expect(creatorPage.getByLabel('Your reply (required)', { exact: true })).toHaveCount(0);
      assert.equal(
        (await get(ownerContext, admin + '/admin/v1/session')).data.state,
        'authenticated',
      );
    },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(fingerprint(), sourceInputs);
  writeFileSync(
    join(evidence, 'acceptance.json'),
    JSON.stringify(
      {
        runId: api.runId,
        backend: api.source,
        sourceInputs,
        sourceUnchangedDuringRun: true,
        checks,
        admissionPauses,
        passed: checks.length,
        network,
        publicBuildModuleCount: publicModules.size,
        staffBuildModuleCount: staffModules.size,
        independentBuildGraphs: true,
        externalIdentityAndResend:
          'DEFERRED by founder; no external requests or client account changes',
        controlledSetup:
          'Node-seeded creator/staff sessions and source/commercial facts; actual production UI, restricted public/admin API, PostgreSQL, Redis and audited commands',
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  process.exitCode = 1;
  await observed
    ?.screenshot({ path: join(evidence, 'synthetic-failure.png'), fullPage: true })
    .catch(() => {});
  writeFileSync(
    join(evidence, 'failure.json'),
    JSON.stringify(
      {
        runId: api?.runId,
        phase,
        errorType: error.name,
        databaseCode: error.code ?? null,
        sqlCode: error.meta?.driverAdapterError?.cause?.originalCode ?? null,
        databaseConstraint: error.meta?.driverAdapterError?.cause?.constraint?.constraint ?? null,
        matcher: error.matcherResult?.name,
        actualStatus: typeof error.actual === 'number' ? error.actual : null,
        expectedStatus: typeof error.expected === 'number' ? error.expected : null,
        callsite: error.stack
          ?.split('\n')
          .find((line) => line.includes('local-staff-combined-acceptance.mjs:')),
        setupOperation: error.setupOperation,
        setupStatus: error.setupStatus,
        setupCode: error.setupCode,
        passed: checks.map((item) => item.name),
      },
      null,
      2,
    ),
  );
  console.error(
    'Combined acceptance failed at ' + phase + '. Private proofs and bodies are omitted.',
  );
} finally {
  await browser?.close();
  if (publicSite) await closeServer(publicSite.httpServer);
  if (staffSite) await closeServer(staffSite.httpServer);
  if (server) await closeServer(server);
  await api?.close();
  writeFileSync(
    join(evidence, 'cleanup.json'),
    JSON.stringify(
      {
        runId: api?.runId,
        ownedBrowserClosed: true,
        ownedServersClosed: true,
        ownedLabelledStorageClosed: true,
      },
      null,
      2,
    ),
  );
}
