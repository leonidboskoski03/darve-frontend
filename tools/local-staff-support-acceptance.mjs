import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { build, preview } from 'vite';
import { chromium, devices, expect } from '@playwright/test';
import { startLocalApi } from './local-api.mjs';
const evidence = resolve('artifacts.local/f08-05');
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
            /^(?:staff\.html|vite\.staff\.config\.ts|package(?:-lock)?\.json|tsconfig[^/]*\.json|tools\/local-(?:api|support-fixture|staff-support-acceptance)\.mjs)$/.test(
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
    task: 'f08-05',
    support: true,
  });
  const runtime = await api.createStaffWorkbench();
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
    data: { category: 'account', body: 'Synthetic workbench creator question.', contexts: [] },
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
  const detail = async (context) => {
    const response = await context.request.get(admin + '/admin/v1/support/tickets/' + id, {
      headers: { Origin: front },
    });
    assert.equal(response.status(), 200);
    return (await response.json()).data;
  };
  await check(
    'independent real staff session and explicit availability; no queue or private detail preload',
    async () => {
      await Promise.all([a.goto(front + '/tickets'), b.goto(front + '/tickets')]);
      for (const page of [a, b])
        await expect(
          page.getByText('Not available for new tickets', { exact: true }),
        ).toBeVisible();
      assert.equal(network.paths.filter((item) => item.method === 'POST').length, 0);
      assert.equal(
        network.paths.some((item) => item.path === '/admin/v1/support/queue'),
        false,
      );
      for (const page of [a, b]) {
        await page
          .getByRole('button', { name: 'Become available for tickets', exact: true })
          .click();
        await expect(page.getByText('Available for new tickets', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Unassigned queue', exact: true }).click();
        await page.getByRole('button', { name: 'Review claim', exact: true }).click();
        await page
          .getByLabel('Claim reason (required)', { exact: true })
          .fill('Reviewed concurrent assignment.');
      }
      assert.equal(
        network.paths.some((item) => item.path === '/admin/v1/support/tickets/' + id),
        false,
      );
    },
  );
  let winner, loser, winnerContext, loserIdentity;
  await check(
    'two real Support sessions race the same queue revision and exactly one obtains private work',
    async () => {
      await Promise.all([
        a.getByRole('button', { name: 'Confirm ticket claim', exact: true }).click(),
        b.getByRole('button', { name: 'Confirm ticket claim', exact: true }).click(),
      ]);
      await expect
        .poll(
          async () =>
            [new URL(a.url()).pathname, new URL(b.url()).pathname].filter(
              (path) => path === '/tickets/' + id,
            ).length,
        )
        .toBe(1);
      winner = new URL(a.url()).pathname.endsWith(id) ? a : b;
      loser = winner === a ? b : a;
      winnerContext = winner === a ? one : two;
      loserIdentity = winner === a ? second : first;
      observed = winner;
      await expect(
        winner.getByText('Synthetic workbench creator question.', { exact: true }),
      ).toBeVisible();
      await expect(loser.locator('.staff-work-messages')).toHaveCount(0);
      await expect(
        winner.getByRole('heading', { name: 'Reassign ticket', exact: true }),
      ).toHaveCount(0);
      const forbidden = await winnerContext.request.post(
        admin + '/admin/v1/support/tickets/' + id + '/reassignments',
        {
          headers: staffHeaders(winner === a ? first : second),
          data: {
            assigneeId: loserIdentity.id,
            expectedAuthorityRevision: (await detail(winnerContext)).authorityRevision,
            reason: 'Denied Support reassignment',
          },
        },
      );
      assert.equal(forbidden.status(), 404);
    },
  );
  await check(
    'real internal notes/read marks stay separate from creator transcript and public revision',
    async () => {
      const before = await (
        await creatorContext.request.get(api.apiOrigin + '/api/support/tickets/' + id, {
          headers: publicHeaders,
        })
      ).json();
      await winner.getByRole('button', { name: /Internal notes \(/ }).click();
      await winner
        .getByLabel('Internal note (required)', { exact: true })
        .fill('Synthetic staff-only internal note.');
      await winner.getByRole('button', { name: 'Save internal note', exact: true }).click();
      await expect(
        winner
          .locator('.staff-work-messages')
          .getByText('Synthetic staff-only internal note.', { exact: true }),
      ).toBeVisible();
      const after = await (
        await creatorContext.request.get(api.apiOrigin + '/api/support/tickets/' + id, {
          headers: publicHeaders,
        })
      ).json();
      assert.deepEqual(before.data, after.data);
      const publicMessages = await (
        await creatorContext.request.get(
          api.apiOrigin + '/api/support/tickets/' + id + '/messages',
          { headers: publicHeaders },
        )
      ).json();
      assert(!JSON.stringify(publicMessages).includes('Synthetic staff-only internal note.'));
      await api.supportFixture.assertPrivateIsolation(id);
      await winner
        .getByRole('button', { name: 'Mark displayed notes as read', exact: true })
        .click();
      await expect(
        winner.getByText('Displayed notes marked as read.', { exact: true }),
      ).toBeVisible();
      assert.equal((await detail(winnerContext)).noteReadSequence, 1);
    },
  );
  await check(
    'lost executed public reply uses explicit exact-key retry with one persisted message',
    async () => {
      await winner.getByRole('button', { name: /Creator conversation \(/ }).click();
      await expect(
        winner.getByText('Synthetic workbench creator question.', { exact: true }),
      ).toBeVisible();
      const requests = [];
      let lost = false;
      await winner.route(admin + '/admin/v1/support/tickets/' + id + '/messages', async (route) => {
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
      await winner
        .getByLabel('Creator reply (required)', { exact: true })
        .fill('Exactly one real synthetic staff reply.');
      await winner.getByRole('button', { name: 'Send creator reply', exact: true }).click();
      await expect(winner.getByText(/The result is unconfirmed/)).toBeVisible();
      assert.equal(requests.length, 1);
      await winner.getByRole('button', { name: 'Retry same staff request', exact: true }).click();
      await expect(
        winner
          .locator('.staff-work-messages')
          .getByText('Exactly one real synthetic staff reply.', { exact: true }),
      ).toBeVisible();
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[0], requests[1]);
      assert.equal((await api.supportFixture.counts(id)).messages, 2);
      await winner.unroute(admin + '/admin/v1/support/tickets/' + id + '/messages');
    },
  );
  await check(
    'explicit stop availability retains existing assignment without silently opting in again',
    async () => {
      await winner.getByRole('button', { name: 'Back to support desk', exact: true }).click();
      await winner.getByRole('button', { name: 'Stop receiving new tickets', exact: true }).click();
      await expect(
        winner.getByText('Not available for new tickets', { exact: true }),
      ).toBeVisible();
      await winner.getByRole('button', { name: 'Open ticket', exact: true }).click();
      await expect(
        winner.getByText('Synthetic workbench creator question.', { exact: true }),
      ).toBeVisible();
    },
  );
  await check(
    'Owner Administrator explicitly reassigns current work and former assignee loses notes/drafts/live access',
    async () => {
      await winner
        .getByLabel('Creator reply (required)', { exact: true })
        .fill('Discard this former-assignee draft.');
      await ownerPage.goto(front + '/tickets/' + id);
      observed = ownerPage;
      await expect(
        ownerPage.getByRole('heading', { name: 'Reassign ticket', exact: true }),
      ).toBeVisible();
      await ownerPage
        .getByLabel('Target staff ID (required)', { exact: true })
        .fill(loserIdentity.id);
      await ownerPage
        .getByLabel('Reassignment reason (required)', { exact: true })
        .fill('Reviewed available Support target.');
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
      await loser.goto(front + '/tickets/' + id);
      await expect(
        loser.getByText('Synthetic workbench creator question.', { exact: true }),
      ).toBeVisible();
      await ownerPage.screenshot({
        path: join(evidence, 'staff-work-desktop.png'),
        fullPage: true,
      });
      await loser.screenshot({
        path: join(evidence, 'staff-work-second-session.png'),
        fullPage: true,
      });
    },
  );
  await check(
    'uncertain atomic status/reply survives refresh and exact-key retry, then retention resync removes history',
    async () => {
      const requests = [];
      let lost = false;
      const statusUrl = admin + '/admin/v1/support/tickets/' + id + '/status';
      await ownerPage.route(statusUrl, async (route) => {
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
      await ownerPage.getByLabel('New ticket status', { exact: true }).selectOption('resolved');
      await ownerPage
        .getByLabel('Status reason (required)', { exact: true })
        .fill('Synthetic issue answered.');
      await ownerPage
        .getByLabel('Optional creator-visible reply', { exact: true })
        .fill('Synthetic final response with resolution.');
      await ownerPage
        .getByRole('checkbox', {
          name: 'I reviewed this status change and any creator-visible reply.',
          exact: true,
        })
        .check();
      await ownerPage.getByRole('button', { name: 'Confirm status change', exact: true }).click();
      await expect(ownerPage.getByText(/The result is unconfirmed/)).toBeVisible();
      await ownerPage.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
      await ownerPage
        .getByRole('button', { name: 'Retry same staff request', exact: true })
        .click();
      await expect(ownerPage.getByText(/The server recorded this request/)).toBeVisible();
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[0], requests[1]);
      assert.equal((await api.supportFixture.counts(id)).messages, 3);
      await ownerPage.unroute(statusUrl);
      await expect(
        ownerPage.getByText('This ticket is resolved. A creator reply can reopen it.', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        ownerPage.getByText('This message is no longer available.', { exact: true }),
      ).toHaveCount(3, { timeout: 10000 });
      await ownerPage.getByRole('button', { name: /Internal notes \(/ }).click();
      await expect(
        ownerPage.getByText('Synthetic staff-only internal note.', { exact: true }),
      ).toBeVisible();
    },
  );
  await check(
    'expired real staff session clears work cache and drafts while other roles remain independent',
    async () => {
      await runtime.expire(owner.id);
      await ownerPage.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
      await expect(
        ownerPage.getByRole('heading', { name: 'Your staff access expired', exact: true }),
      ).toBeVisible();
      await expect(ownerPage.locator('.staff-work-messages')).toHaveCount(0);
      await loser.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
      await expect(
        loser.getByRole('heading', { name: 'Creator conversation', exact: true }),
      ).toBeVisible();
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
        matcher: error.matcherResult?.name ?? null,
        callsite:
          error.stack
            ?.split('\n')
            .find((line) => line.includes('local-staff-support-acceptance.mjs:'))
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
