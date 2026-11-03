import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { build, preview } from 'vite';
import { chromium, devices, expect } from '@playwright/test';
import { startLocalApi } from './local-api.mjs';
const evidence = resolve('artifacts.local/f08-06');
mkdirSync(evidence, { recursive: true });
const output = resolve(evidence, 'runtime-build');
assert(output.startsWith(evidence + sep) && output !== evidence);
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
          ((file.startsWith('src/') &&
            !/\.(?:test|test-helper|test-support)\./.test(file) &&
            !file.startsWith('src/app/preview/')) ||
            file.startsWith('public/') ||
            /^(?:staff\.html|vite\.staff\.config\.ts|package(?:-lock)?\.json|tsconfig[^/]*\.json|tools\/local-(?:api|support-fixture|staff-admin-acceptance|staff-admin-seed)\.mjs)$/.test(
              file,
            )),
      )
      .sort()
      .map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
  );
const sourceInputs = fingerprint(),
  checks = [],
  network = { creatorCookie: false, staffCookie: false, referrer: false, paths: [] };
let api,
  server,
  site,
  identityServer,
  browser,
  observed,
  phase = 'setup';
const front = 'http://localhost:4176',
  admin = 'http://localhost:3320',
  origin = 'http://127.0.0.1:4175';
const check = async (name, action) => {
  phase = name;
  await action();
  checks.push({ name, passed: true });
  console.log(JSON.stringify({ check: name, passed: true }));
};
try {
  api = await startLocalApi({
    backend: process.argv[2] ?? '../tmp/backend-f06-checkout',
    origins: [origin],
    task: 'f08-06',
    support: true,
  });
  const runtime = await api.createStaffWorkbench();
  identityServer = createServer(runtime.identityHandler);
  await new Promise((done, reject) => {
    identityServer.once('error', reject);
    identityServer.listen(3321, 'localhost', done);
  });
  server = createServer((request, response) => {
    const cookie = request.headers.cookie ?? '';
    network.creatorCookie ||= cookie.includes('darve_session=');
    network.staffCookie ||= cookie.includes('darve_staff_dev_session=');
    network.referrer ||= Boolean(request.headers.referer);
    network.paths.push({ path: (request.url ?? '').split('?')[0], method: request.method });
    runtime.app(request, response);
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(3320, 'localhost', done);
  });
  process.env.STAFF_PUBLIC_APP_ENV = 'local';
  process.env.STAFF_PUBLIC_API_ORIGIN = admin;
  process.env.STAFF_PUBLIC_AUTHORIZATION_ENDPOINT = 'http://localhost:3321/authorize';
  const modules = new Set();
  await build({
    configFile: 'vite.staff.config.ts',
    envDir: false,
    mode: 'staff-work-acceptance',
    logLevel: 'silent',
    build: { outDir: output, emptyOutDir: true },
    plugins: [
      {
        name: 'staff-work-import-proof',
        generateBundle(_options, bundle) {
          for (const chunk of Object.values(bundle))
            if (chunk.type === 'chunk')
              for (const id of chunk.moduleIds) modules.add(id.replaceAll('\\', '/'));
        },
      },
    ],
  });
  assert(
    [...modules].every(
      (id) =>
        !/\/src\/(?:features\/(?:creator-access|support|landing|contributions|overlay-display)|services\/creator-session|routes\/(?:router|creator-runtime))\b/.test(
          id,
        ),
    ),
  );
  site = await preview({
    configFile: 'vite.staff.config.ts',
    envDir: false,
    mode: 'staff-work-acceptance',
    logLevel: 'silent',
    build: { outDir: output },
    preview: { host: 'localhost', port: 4176, strictPort: true },
  });
  browser = await chromium.launch();
  const creator = await api.seedSession({ expiresInMs: 600000 });
  const inspection = await api.seedStaffInspection(creator);
  const creatorContext = await browser.newContext();
  await creatorContext.addCookies([
    {
      name: 'darve_session',
      value: creator.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const creatorSession = await (
    await creatorContext.request.get(api.apiOrigin + '/api/session', {
      headers: { Origin: origin },
    })
  ).json();
  const publicHeaders = { Origin: origin, 'X-CSRF-Token': creatorSession.csrfToken };
  const created = await creatorContext.request.post(api.apiOrigin + '/api/support/tickets', {
    headers: { ...publicHeaders, 'Idempotency-Key': randomUUID() },
    data: {
      category: 'challenge',
      body: 'Synthetic workbench creator question.',
      contexts: [{ kind: 'challenge', id: inspection.id }],
    },
  });
  assert.equal(created.status(), 200);
  const id = (await created.json()).data.ticketId;
  const first = await runtime.seed(),
    second = await runtime.seed(),
    owner = await runtime.seed('OWNER_ADMIN');
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
  const one = await staffContext(first, { viewport: { width: 1440, height: 950 } }),
    two = await staffContext(second, { ...devices['Pixel 7'] }),
    ownerContext = await staffContext(owner, { viewport: { width: 1440, height: 950 } });
  const a = await one.newPage(),
    b = await two.newPage(),
    ownerPage = await ownerContext.newPage();
  observed = a;
  const staffHeaders = (identity) => ({
    Origin: front,
    'x-staff-csrf': identity.csrf,
    'Idempotency-Key': randomUUID(),
  });

  const headersFor = async (context) => {
    const response = await context.request.get(admin + '/admin/v1/session');
    assert.equal(response.status(), 200);
    return {
      Origin: front,
      'X-Staff-CSRF': (await response.json()).data.csrfToken,
      'Idempotency-Key': randomUUID(),
    };
  };
  const confirm = async (root, title, label, reason = 'Reviewed synthetic staff action.') => {
    const form = root.getByRole('form', { name: title, exact: true });
    await form.getByLabel(title + ' reason (required)', { exact: true }).fill(reason);
    await expect(form.getByRole('button', { name: label, exact: true })).toBeDisabled();
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: label, exact: true }).click();
  };
  const creatorUrl = front + '/reviews?view=streamer&id=' + creator.userId;
  const challengeUrl = front + '/reviews?view=challenge&id=' + inspection.id;
  const creatorFinancial = await inspection.financialEvidence();
  await check(
    'actual safe challenge projection retains exact money and read-only stored funding across a real staff reload',
    async () => {
      await ownerPage.goto(challengeUrl);
      observed = ownerPage;
      await expect(
        ownerPage.getByText('9007199254740993 minor units · EUR', { exact: true }),
      ).toBeVisible();
      await expect(
        ownerPage.getByRole('heading', { name: 'Stored funding projection', exact: true }),
      ).toBeVisible();
      await ownerPage.reload();
      await expect(
        ownerPage.getByText('9007199254740993 minor units · EUR', { exact: true }),
      ).toBeVisible();
      assert.equal(new URL(ownerPage.url()).searchParams.get('id'), inspection.id);
      assert.deepEqual(await inspection.financialEvidence(), creatorFinancial);
      const directoryPage = await ownerContext.request.get(admin + '/admin/v1/staff?limit=1');
      assert.equal(directoryPage.status(), 200);
      const firstPage = (await directoryPage.json()).data;
      assert.equal(firstPage.items.length, 1);
      assert(firstPage.nextCursor);
      const nextPage = await ownerContext.request.get(
        admin + '/admin/v1/staff?limit=1&cursor=' + encodeURIComponent(firstPage.nextCursor),
      );
      assert.equal(nextPage.status(), 200);
      assert.notEqual((await nextPage.json()).data.items[0].id, firstPage.items[0].id);
    },
  );
  await check(
    'Support inspection is bound to current assigned challenge context; unrelated Support cannot preload it',
    async () => {
      for (const [context, identity] of [
        [one, first],
        [two, second],
      ]) {
        const available = await context.request.get(admin + '/admin/v1/support/availability');
        assert.equal(available.status(), 200);
        const set = await context.request.post(admin + '/admin/v1/support/availability', {
          headers: staffHeaders(identity),
          data: { available: true, expectedRevision: (await available.json()).data.revision },
        });
        assert.equal(set.status(), 200);
      }
      const queue = await one.request.get(admin + '/admin/v1/support/queue?limit=20');
      assert.equal(queue.status(), 200);
      const item = (await queue.json()).data.items.find((row) => row.id === id);
      assert(item);
      const claim = await one.request.post(admin + '/admin/v1/support/tickets/' + id + '/claims', {
        headers: staffHeaders(first),
        data: {
          expectedAuthorityRevision: item.authorityRevision,
          reason: 'Controlled assignment for actual inspection.',
        },
      });
      assert.equal(claim.status(), 200);
      await a.goto(challengeUrl);
      observed = a;
      await expect(
        a.getByText('9007199254740993 minor units · EUR', { exact: true }),
      ).toBeVisible();
      await b.goto(challengeUrl);
      await expect(b.getByText(/This record or action is unavailable/)).toBeVisible();
      await expect(b.getByText('9007199254740993 minor units · EUR', { exact: true })).toHaveCount(
        0,
      );
      await expect(a.getByRole('button', { name: 'Staff members', exact: true })).toHaveCount(0);
      for (const [path, status] of [
        ['/staff', 403],
        ['/audit-events', 403],
        ['/streamers/' + creator.userId + '/restrictions', 404],
      ])
        assert.equal((await one.request.get(admin + '/admin/v1' + path)).status(), status);
      for (const [path, data] of [
        [
          '/invitations',
          {
            email: 'denied-synthetic@example.test',
            role: 'SUPPORT',
            reason: 'Denied Support invitation.',
          },
        ],
        [
          '/staff/' + owner.id + '/revocations',
          { action: 'revoke', expectedVersion: 1, reason: 'Denied Support staff revocation.' },
        ],
        [
          '/streamers/' + creator.userId + '/restrictions',
          {
            action: 'ban',
            expectedVersion: 0,
            reason: 'Denied Support ban.',
            confirmation: { targetId: creator.userId, action: 'ban', expectedVersion: 0 },
          },
        ],
      ])
        assert.equal(
          (
            await one.request.post(admin + '/admin/v1' + path, {
              headers: staffHeaders(first),
              data,
            })
          ).status(),
          403,
        );
    },
  );
  let reviewId;
  await check(
    'assigned Support flags real challenge without banning and cannot perform owner review transitions',
    async () => {
      await confirm(
        a,
        'Flag for manual review',
        'Confirm review flag',
        'Synthetic assigned-context concern.',
      );
      await expect(a.getByText(/The server recorded this exact request/)).toBeVisible();
      const reviews = await one.request.get(admin + '/admin/v1/reviews?limit=20');
      assert.equal(reviews.status(), 200);
      const row = (await reviews.json()).data.items[0];
      assert.equal(row.challengeId, inspection.id);
      assert.equal(row.state, 'open');
      reviewId = row.id;
      const denied = await one.request.post(
        admin + '/admin/v1/reviews/' + reviewId + '/transitions',
        {
          headers: await headersFor(one),
          data: {
            state: 'in_review',
            reason: 'Denied Support transition.',
            expectedVersion: row.revision,
            confirmation: { targetId: reviewId, state: 'in_review', expectedVersion: row.revision },
          },
        },
      );
      assert.equal(denied.status(), 403);
      assert.equal(
        (
          await ownerContext.request.get(
            admin + '/admin/v1/streamers/' + creator.userId + '/restrictions',
          )
        ).status(),
        200,
      );
    },
  );
  await check(
    'reassignment removes the former Support inspection and draft while the new assignee gains context',
    async () => {
      await a
        .getByLabel('Flag for manual review reason (required)', { exact: true })
        .fill('Discard this former-assignee inspection draft.');
      const current = await ownerContext.request.get(admin + '/admin/v1/support/tickets/' + id);
      assert.equal(current.status(), 200);
      const assignment = await ownerContext.request.post(
        admin + '/admin/v1/support/tickets/' + id + '/reassignments',
        {
          headers: await headersFor(ownerContext),
          data: {
            assigneeId: second.id,
            expectedAuthorityRevision: (await current.json()).data.authorityRevision,
            reason: 'Reviewed synthetic inspection-context transfer.',
          },
        },
      );
      assert.equal(assignment.status(), 200);
      await a.getByRole('button', { name: 'Refresh current records', exact: true }).click();
      await expect(a.getByText(/This record or action is unavailable/)).toBeVisible();
      await expect(a.getByText('9007199254740993 minor units · EUR', { exact: true })).toHaveCount(
        0,
      );
      await expect(a.getByRole('checkbox')).toHaveCount(0);
      await b.goto(challengeUrl);
      await expect(
        b.getByText('9007199254740993 minor units · EUR', { exact: true }),
      ).toBeVisible();
    },
  );
  await check(
    'owner review transition uses current exact confirmation and a stale form resets before resolving',
    async () => {
      await ownerPage.goto(front + '/reviews');
      observed = ownerPage;
      const form = ownerPage.getByRole('form', { name: 'Advance manual review', exact: true });
      await form
        .getByLabel('Advance manual review reason (required)', { exact: true })
        .fill('Stale reviewed action.');
      await form.getByRole('checkbox').check();
      const transition = await ownerContext.request.post(
        admin + '/admin/v1/reviews/' + reviewId + '/transitions',
        {
          headers: await headersFor(ownerContext),
          data: {
            state: 'in_review',
            reason: 'Concurrent actual review transition.',
            expectedVersion: 1,
            confirmation: { targetId: reviewId, state: 'in_review', expectedVersion: 1 },
          },
        },
      );
      assert.equal(transition.status(), 200);
      await form.getByRole('button', { name: 'Confirm review transition', exact: true }).click();
      await expect(ownerPage.getByText(/This record changed or its page expired/)).toBeVisible();
      await expect(
        ownerPage.getByRole('button', { name: 'Confirm review transition', exact: true }),
      ).toBeDisabled();
      await expect(
        ownerPage.getByText('Synthetic assigned-context concern.', { exact: true }),
      ).toBeVisible();
      await confirm(
        ownerPage,
        'Advance manual review',
        'Confirm review transition',
        'Synthetic review resolved.',
      );
      await expect(ownerPage.getByRole('heading', { name: /Review .*resolved/ })).toBeVisible();
    },
  );
  await check(
    'uncertain executed ban survives refresh and same-key retry without duplicate moderation evidence',
    async () => {
      await ownerPage.goto(creatorUrl);
      observed = ownerPage;
      const url = admin + '/admin/v1/streamers/' + creator.userId + '/restrictions',
        requests = [];
      let lost = false;
      await ownerPage.route(url, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        requests.push({
          key: route.request().headers()['idempotency-key'],
          body: route.request().postData(),
        });
        if (!lost) {
          lost = true;
          assert.equal((await route.fetch()).status(), 200);
          await route.abort();
        } else await route.continue();
      });
      const before = await runtime.evidence(owner.id);
      await confirm(ownerPage, 'Ban creator', 'Confirm ban', 'Synthetic restriction decision.');
      await expect(ownerPage.getByText(/The result is unconfirmed/)).toBeVisible();
      await ownerPage.getByRole('button', { name: 'Refresh current records', exact: true }).click();
      await expect(ownerPage.getByText(/Banned from new activity/)).toBeVisible();
      await ownerPage.getByRole('button', { name: 'Retry same staff action', exact: true }).click();
      await expect(ownerPage.getByText(/The server recorded this exact request/)).toBeVisible();
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[0], requests[1]);
      assert.equal((await runtime.evidence(owner.id)).audit, before.audit + 1);
      const restricted = await ownerContext.request.get(url);
      assert.equal((await restricted.json()).data.revision, 1);
      await ownerPage.unroute(url);
    },
  );
  await check(
    'server fresh-assurance failure clears work; explicit controlled password/code step-up rotates session without replay',
    async () => {
      await runtime.ageIdentity(owner.id);
      await runtime.selectIdentity(owner.id);
      const mutations = () =>
        network.paths.filter((row) => row.method === 'POST' && row.path.endsWith('/restrictions'))
          .length;
      const before = mutations();
      await confirm(
        ownerPage,
        'Remove creator ban',
        'Confirm unban',
        'Reviewed unban requiring fresh identity.',
      );
      await expect(
        ownerPage
          .getByRole('alert')
          .filter({ hasText: 'This action needs fresh identity verification' }),
      ).toBeVisible();
      await expect(
        ownerPage.getByRole('button', { name: 'Confirm unban', exact: true }),
      ).toHaveCount(0);
      assert.equal(mutations(), before + 1);
      await ownerPage.getByRole('button', { name: 'Verify identity again', exact: true }).click();
      await expect(
        ownerPage.getByRole('heading', { name: 'Controlled identity fixture', exact: true }),
      ).toBeVisible();
      await ownerPage
        .getByRole('button', { name: 'Continue controlled identity', exact: true })
        .click();
      await expect(
        ownerPage.getByRole('heading', { name: 'Check your email', exact: true }),
      ).toBeVisible();
      assert(runtime.inbox.length > 0);
      await ownerPage
        .getByLabel('Email verification code (required)', { exact: true })
        .fill(runtime.inbox.at(-1).code);
      await ownerPage.getByRole('button', { name: 'Verify code', exact: true }).click();
      await expect(
        ownerPage.getByRole('heading', { name: 'Manual reviews', exact: true }),
      ).toBeVisible();
      assert.equal(mutations(), before + 1);
      const old = await browser.newContext();
      await old.addCookies([
        {
          name: 'darve_staff_dev_session',
          value: owner.secret,
          url: admin,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      assert.equal((await old.request.get(admin + '/admin/v1/staff')).status(), 401);
      await old.close();
      await ownerPage.goto(creatorUrl);
      await confirm(
        ownerPage,
        'Remove creator ban',
        'Confirm unban',
        'Newly reviewed unban after step-up.',
      );
      await expect(ownerPage.getByText(/Not currently banned/)).toBeVisible();
    },
  );
  await check(
    'uncertain real invitation replay confirms one existing invitation without recovering a private secret; explicit revocation is audited',
    async () => {
      await ownerPage.goto(front + '/reviews?view=staff');
      observed = ownerPage;
      const url = admin + '/admin/v1/invitations',
        requests = [];
      let lost = false,
        invitationId;
      await ownerPage.route(url, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        requests.push({
          key: route.request().headers()['idempotency-key'],
          body: route.request().postData(),
        });
        if (!lost) {
          lost = true;
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          invitationId = (await response.json()).data.id;
          await route.abort();
        } else await route.continue();
      });
      const before = await runtime.evidence(owner.id);
      await ownerPage
        .getByLabel('Invited identity', { exact: true })
        .fill('synthetic-new-staff@example.test');
      await confirm(
        ownerPage,
        'Create staff invitation',
        'Confirm invitation creation',
        'Synthetic invitation review.',
      );
      await expect(ownerPage.getByText(/The result is unconfirmed/)).toBeVisible();
      await ownerPage.getByRole('button', { name: 'Refresh current records', exact: true }).click();
      await ownerPage.getByRole('button', { name: 'Retry same staff action', exact: true }).click();
      await expect(
        ownerPage.getByText(/This replay confirms the existing invitation/),
      ).toBeVisible();
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[0], requests[1]);
      assert.equal((await runtime.evidence(owner.id)).invitations, before.invitations + 1);
      await expect(
        ownerPage.getByRole('button', { name: 'Show private invitation link', exact: true }),
      ).toHaveCount(0);
      assert(invitationId);
      await ownerPage.unroute(url);
      await ownerPage.getByLabel('Invitation ID to revoke', { exact: true }).fill(invitationId);
      await confirm(
        ownerPage,
        'Revoke invitation',
        'Confirm invitation revocation',
        'Synthetic invitation cancellation.',
      );
      await expect(ownerPage.getByText(/The server recorded this exact request/)).toBeVisible();
    },
  );
  await check(
    'current owner changes a loaded member role and revokes membership; previous sessions immediately fail',
    async () => {
      const row = ownerPage.locator('.staff-admin-records>li').filter({ hasText: first.id });
      await confirm(
        row,
        'Change staff role',
        'Confirm staff role change',
        'Synthetic reviewed promotion.',
      );
      await expect(row.getByText(/Revision 2/)).toBeVisible();
      assert.equal((await runtime.evidence(first.id)).principal.role, 'OWNER_ADMIN');
      await a.getByRole('button', { name: 'Refresh current records', exact: true }).click();
      await expect(
        a.getByRole('heading', { name: 'Your staff access expired', exact: true }),
      ).toBeVisible();
      await confirm(
        row,
        'Revoke staff membership',
        'Confirm staff revocation',
        'Synthetic reviewed revocation.',
      );
      await expect(row.getByText('This membership is inactive.', { exact: true })).toBeVisible();
      const principal = (await runtime.evidence(first.id)).principal;
      assert.equal(principal.active, false);
      assert.equal(principal.revision, 3);
    },
  );
  await check(
    'last active owner protection rejects self-revocation and audit history uses persisted safe reasons',
    async () => {
      await runtime.removeSetupOwner();
      await ownerPage.getByRole('button', { name: 'Refresh current records', exact: true }).click();
      const row = ownerPage.locator('.staff-admin-records>li').filter({ hasText: owner.id });
      await confirm(
        row,
        'Revoke staff membership',
        'Confirm staff revocation',
        'Synthetic last-owner protection check.',
      );
      await expect(ownerPage.getByText(/This record changed or its page expired/)).toBeVisible();
      assert.equal((await runtime.evidence(owner.id)).principal.active, true);
      await ownerPage.getByRole('button', { name: 'Audit history', exact: true }).click();
      const auditFirst = await ownerContext.request.get(admin + '/admin/v1/audit-events?limit=1');
      assert.equal(auditFirst.status(), 200);
      const auditPage = (await auditFirst.json()).data;
      assert(auditPage.nextCursor);
      const auditNext = await ownerContext.request.get(
        admin + '/admin/v1/audit-events?limit=1&cursor=' + encodeURIComponent(auditPage.nextCursor),
      );
      assert.equal(auditNext.status(), 200);
      assert.notEqual((await auditNext.json()).data.items[0].id, auditPage.items[0].id);
      await expect(ownerPage.locator('.staff-admin-filters')).toHaveCount(0);
      await expect(ownerPage.locator('.staff-admin-records')).toHaveCount(1);
      await expect(
        ownerPage.getByText('Synthetic reviewed revocation.', { exact: true }),
      ).toBeVisible();
      await ownerPage.evaluate(
        () =>
          new Promise((done) => {
            globalThis.scrollTo(0, 0);
            globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(done));
          }),
      );
      writeFileSync(
        join(evidence, 'visual-layout.json'),
        JSON.stringify(
          await ownerPage.evaluate(() => ({
            scrollY: globalThis.scrollY,
            children: [...globalThis.document.querySelector('main').children].map((node) => ({
              tag: node.tagName,
              class: node.className,
              y: node.getBoundingClientRect().y,
              height: node.getBoundingClientRect().height,
            })),
          })),
          null,
          2,
        ),
      );
      await ownerPage.screenshot({
        path: join(evidence, 'staff-admin-desktop.png'),
        fullPage: false,
      });
    },
  );
  await check(
    'Support context loss clears inspection and forms; safe source restriction removes original content without changing stored finance',
    async () => {
      // The first assignee was revoked above; reassign with the still-valid tested owner API to the other eligible Support.
      const ticketResponse = await ownerContext.request.get(
        admin + '/admin/v1/support/tickets/' + id,
      );
      assert.equal(ticketResponse.status(), 200);
      if ((await ticketResponse.json()).data.assigneeId !== second.id) {
        const current = await ownerContext.request.get(admin + '/admin/v1/support/tickets/' + id);
        const assign = await ownerContext.request.post(
          admin + '/admin/v1/support/tickets/' + id + '/reassignments',
          {
            headers: await headersFor(ownerContext),
            data: {
              assigneeId: second.id,
              expectedAuthorityRevision: (await current.json()).data.authorityRevision,
              reason: 'Synthetic inspection reassignment.',
            },
          },
        );
        assert.equal(assign.status(), 200);
      }
      await b.goto(challengeUrl);
      observed = b;
      await expect(
        b.getByText('9007199254740993 minor units · EUR', { exact: true }),
      ).toBeVisible();
      await b.screenshot({ path: join(evidence, 'staff-admin-mobile.png'), fullPage: true });
      await inspection.redact();
      await b.getByRole('button', { name: 'Refresh current records', exact: true }).click();
      await expect(
        b.getByText('Source content is no longer available.', { exact: true }),
      ).toBeVisible();
      assert.deepEqual(await inspection.financialEvidence(), creatorFinancial);
      await runtime.expire(second.id);
      await b.getByRole('button', { name: 'Refresh current records', exact: true }).click();
      await expect(
        b.getByRole('heading', { name: 'Your staff access expired', exact: true }),
      ).toBeVisible();
      await expect(b.locator('.staff-admin-detail')).toHaveCount(0);
    },
  );

  assert(network.staffCookie);
  assert.equal(network.creatorCookie, false);
  assert.equal(network.referrer, false);
  assert.deepEqual(fingerprint(), sourceInputs);
  writeFileSync(
    join(evidence, 'actual-proof.json'),
    JSON.stringify(
      {
        runId: api.runId,
        backend: api.source,
        sourceInputs,
        sourceUnchangedDuringRun: true,
        checks,
        staffCookieSeen: true,
        creatorCookieAbsent: true,
        referrerAbsent: true,
        staffBuildModuleCount: modules.size,
        creatorBuildModulesAbsent: true,
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
        strictLocatorFailure: error.message?.includes('strict mode violation') ?? false,
        setupOperation: error.setupOperation ?? null,
        setupStatus: error.setupStatus ?? null,
        setupCode: error.setupCode ?? null,
        matcher: error.matcherResult?.name ?? null,
        callsite:
          error.stack
            ?.split('\n')
            .find((line) => line.includes('local-staff-admin-acceptance.mjs:'))
            ?.trim() ?? null,
        pagePath: observed ? new URL(observed.url()).pathname : null,
        passed: checks.map((item) => item.name),
      },
      null,
      2,
    ),
  );
  console.error(
    'Staff work acceptance failed at ' + phase + '. Private proofs and bodies are omitted.',
  );
} finally {
  await browser?.close();
  if (site)
    await new Promise((done) => {
      site.httpServer.close(done);
      site.httpServer.closeAllConnections();
    });
  if (server)
    await new Promise((done) => {
      server.close(done);
      server.closeAllConnections();
    });
  if (identityServer)
    await new Promise((done) => {
      identityServer.close(done);
      identityServer.closeAllConnections();
    });
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
