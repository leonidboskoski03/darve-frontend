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
const evidence = resolve('artifacts.local/f08-07'),
  checks = [],
  errors = [];
mkdirSync(evidence, { recursive: true });
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
          (/^(src|public)\//.test(file) ||
            /^(package.*json|vite.*ts|staff.html|tools\/local-(api|support-fixture|staff-admin-seed|staff-recovery-acceptance)\.mjs)$/.test(
              file,
            )),
      )
      .sort()
      .map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
  );
const sourceInputs = fingerprint(),
  front = 'http://localhost:4176',
  admin = 'http://localhost:3320',
  origin = 'http://127.0.0.1:4175';
let api,
  browser,
  site,
  server,
  publicSite,
  observed,
  inspectionResult,
  phase = 'setup';
const check = async (name, fn) => {
  phase = name;
  await fn();
  checks.push(name);
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
    task: 'f08-07',
    support: true,
  });
  browser = await chromium.launch();
  const creator = await api.seedSession({ expiresInMs: 600000 });
  const publicContext = await browser.newContext();
  await publicContext.addCookies([
    {
      name: 'darve_session',
      value: creator.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const inspection = await api.seedStaffInspection(creator, {
    disclosed: true,
    evidenceDirectory: evidence,
    reviewInBrowser: async ({ base, roundId, item }) => {
      await check(
        'actual creator pre-acceptance policy and unchecked extension disclosure persist with accepted immutable terms',
        async () => {
          process.env.VITE_APP_ENV = 'local';
          process.env.VITE_PUBLIC_API_ORIGIN = base;
          await build({
            configFile: 'vite.config.ts',
            envDir: false,
            mode: 'recovery-public-acceptance',
            logLevel: 'silent',
            build: { outDir: join(evidence, 'public-build'), emptyOutDir: true },
          });
          publicSite = await preview({
            configFile: 'vite.config.ts',
            envDir: false,
            mode: 'recovery-public-acceptance',
            logLevel: 'silent',
            build: { outDir: join(evidence, 'public-build') },
            preview: { host: '127.0.0.1', port: 4175, strictPort: true },
          });
          const page = await publicContext.newPage();
          observed = page;
          page.on('pageerror', (error) => errors.push(error.name));
          await page.goto(origin + '/collection/' + roundId + '/suggestions');
          await page.getByRole('button', { name: 'Accept idea ' + item.rank, exact: true }).click();
          await page.getByLabel('Funding goal', { exact: true }).fill('25.50');
          await page.getByLabel('Funding duration in seconds', { exact: true }).fill('600');
          await expect(page.getByText(/Allowed goal:/)).toBeVisible();
          const review = page.getByRole('button', { name: 'Review exact terms', exact: true });
          await expect(review).toBeDisabled();
          await page
            .getByRole('checkbox', {
              name: /I understand and accept this funding extension policy/,
            })
            .check();
          await review.click();
          await expect(
            page.getByText('Accepted extension disclosure', { exact: true }),
          ).toBeVisible();
          const result = page.waitForResponse(
            (response) =>
              response.url() ===
                base + '/api/rounds/' + roundId + '/suggestions/' + item.id + '/accept' &&
              response.request().method() === 'POST',
          );
          await page.getByRole('button', { name: 'Confirm acceptance', exact: true }).click();
          const response = await result;
          assert.equal(response.status(), 201);
          inspectionResult = (await response.json()).data;
          await page.screenshot({
            path: join(evidence, 'synthetic-creator-accepted.png'),
            fullPage: true,
          });
          await page.close();
          await closeServer(publicSite.httpServer);
          publicSite = null;
        },
      );
      return inspectionResult;
    },
  });
  const runtime = await api.createStaffWorkbench();
  server = createServer(runtime.app);
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(3320, 'localhost', done);
  });
  process.env.STAFF_PUBLIC_APP_ENV = 'local';
  process.env.STAFF_PUBLIC_API_ORIGIN = admin;
  process.env.STAFF_PUBLIC_AUTHORIZATION_ENDPOINT = 'http://localhost:3321/authorize';
  const staffModules = new Set();
  await build({
    configFile: 'vite.staff.config.ts',
    envDir: false,
    mode: 'recovery-staff-acceptance',
    logLevel: 'silent',
    build: { outDir: join(evidence, 'staff-build'), emptyOutDir: true },
    plugins: [
      {
        name: 'recovery-entry-proof',
        generateBundle(_options, bundle) {
          for (const chunk of Object.values(bundle))
            if (chunk.type === 'chunk')
              for (const id of chunk.moduleIds) staffModules.add(id.replaceAll('\\', '/'));
        },
      },
    ],
  });
  assert(
    [...staffModules].every(
      (id) =>
        !/\/src\/(?:services\/creator-session|features\/(?:creator-access|contributions|overlay-display))\//.test(
          id,
        ),
    ),
  );
  site = await preview({
    configFile: 'vite.staff.config.ts',
    envDir: false,
    mode: 'recovery-staff-acceptance',
    logLevel: 'silent',
    build: { outDir: join(evidence, 'staff-build') },
    preview: { host: 'localhost', port: 4176, strictPort: true },
  });
  const creatorSession = await (
    await publicContext.request.get(api.apiOrigin + '/api/session', { headers: { Origin: origin } })
  ).json();
  const publicHeaders = {
    Origin: origin,
    'X-CSRF-Token': creatorSession.csrfToken,
    'Idempotency-Key': randomUUID(),
  };
  const response = await publicContext.request.post(api.apiOrigin + '/api/support/tickets', {
    headers: publicHeaders,
    data: {
      category: 'challenge',
      body: 'Synthetic recovery question.',
      contexts: [{ kind: 'challenge', id: inspection.id }],
    },
  });
  assert.equal(response.status(), 200);
  const ticketId = (await response.json()).data.ticketId;
  const owner = await runtime.seed('OWNER_ADMIN'),
    support = await runtime.seed('SUPPORT');
  const contextFor = async (identity, options = {}) => {
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
  const ownerContext = await contextFor(owner, { viewport: { width: 1440, height: 1100 } }),
    supportContext = await contextFor(support, devices['Pixel 7']);
  const page = await ownerContext.newPage();
  observed = page;
  page.on('pageerror', (error) => errors.push(error.name));
  const path = '/admin/v1/support/tickets/' + ticketId,
    contextPath = path + '/recovery/' + inspection.id;
  const get = async (context, url, status = 200) => {
    const response = await context.request.get(admin + url);
    assert.equal(response.status(), status);
    return response.json();
  };
  const post = async (context, identity, url, data, key = randomUUID(), status = 200) => {
    const response = await context.request.post(admin + url, {
      headers: { Origin: front, 'x-staff-csrf': identity.csrf, 'Idempotency-Key': key },
      data,
    });
    assert.equal(response.status(), status);
    return response.json();
  };
  const current = async () => (await get(ownerContext, contextPath)).data;
  const threadUrl = front + '/tickets/' + ticketId;
  const initialEvidence = await runtime.recoveryEvidence(inspection.id);
  await check(
    'current owner recovery is ticket-bound; Support and foreign contexts cannot read or execute it',
    async () => {
      await get(supportContext, contextPath, 403);
      await get(ownerContext, path + '/recovery/' + randomUUID(), 404);
      await page.goto(threadUrl);
      await expect(
        page.getByRole('heading', { name: 'Audited recovery', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText('Configured policy synthetic-recovery-v1.', { exact: false }),
      ).toBeVisible();
      assert.equal((await current()).fundingWindow.policyVersion, 'support-extension-v1');
      const c = await current();
      await post(
        supportContext,
        support,
        path + '/extensions',
        {
          challengeId: c.challengeId,
          expectedTicketRevision: c.ticketRevision,
          expectedContextRevision: c.contextRevision,
          expectedAuthorityRevision: c.authorityRevision,
          expectedFundingRevision: c.fundingRevision,
          expectedPerformanceRevision: c.performanceRevision,
          expectedWindowRevision: c.fundingWindow.revision,
          addedSeconds: 60,
          reason: 'Denied Support action.',
          confirmation: {
            challengeId: c.challengeId,
            previousDeadline: c.fundingWindow.effectiveClosesAt,
            newDeadline: new Date(
              Date.parse(c.fundingWindow.effectiveClosesAt) + 60000,
            ).toISOString(),
          },
        },
        randomUUID(),
        403,
      );
    },
  );
  await check(
    'disabled consumer readiness exposes no recovery policy or action and restores only after explicit test setup',
    async () => {
      await runtime.recoveryReady(false);
      const off = await current();
      assert.deepEqual(Object.keys(off).sort(), ['challengeId', 'state', 'ticketId']);
      await page.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
      await expect(page.getByText(/Recovery is disabled/)).toBeVisible();
      await runtime.recoveryReady(true);
      await page.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
      await expect(page.getByLabel('Additional funding seconds')).toBeEnabled();
    },
  );
  await check(
    'unknown extension result holds exact reviewed request through refresh; one deliberate same-key retry records one audited effect',
    async () => {
      let lost = false;
      const writes = [];
      await page.route(admin + path + '/extensions', async (route) => {
        writes.push({
          body: route.request().postData(),
          key: route.request().headers()['idempotency-key'],
        });
        const response = await route.fetch();
        if (!lost) {
          lost = true;
          assert.equal(response.status(), 200);
          await route.abort('failed');
        } else await route.fulfill({ response });
      });
      await page.getByLabel('Additional funding seconds').fill('60');
      await page
        .getByLabel('Extension reason', { exact: false })
        .fill('Reviewed synthetic interrupted stream.');
      const submit = page.getByRole('button', { name: 'Confirm funding extension', exact: true });
      await expect(submit).toBeDisabled();
      await page.getByRole('checkbox', { name: /I reviewed this exact challenge/ }).check();
      await submit.click();
      await expect(
        page.getByRole('button', { name: 'Retry same staff request', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Confirm funding extension', exact: true }),
      ).toBeDisabled();
      await page.getByRole('button', { name: 'Retry same staff request', exact: true }).click();
      await expect(page.getByText(/The server recorded this request/)).toBeVisible();
      assert.equal(writes.length, 2);
      assert.deepEqual(writes[0], writes[1]);
      await page.unroute(admin + path + '/extensions');
      const c = await current(),
        e = await runtime.recoveryEvidence(inspection.id);
      assert.equal(c.fundingWindow.revision, 1);
      assert.equal(c.fundingWindow.cumulativeSeconds, 60);
      assert.equal(e.actions.length, 1);
      assert.equal(e.actions[0].kind, 'extension');
      assert(e.actions[0].auditId && e.actions[0].outboxId);
      assert.deepEqual(e.challenge, initialEvidence.challenge);
      assert.deepEqual(e.funding, initialEvidence.funding);
    },
  );
  await check(
    'stale revisions and configured per-action/cumulative bounds cannot create a replacement extension',
    async () => {
      const c = await current();
      const input = {
        challengeId: c.challengeId,
        expectedTicketRevision: c.ticketRevision,
        expectedContextRevision: c.contextRevision,
        expectedAuthorityRevision: c.authorityRevision,
        expectedFundingRevision: c.fundingRevision,
        expectedPerformanceRevision: c.performanceRevision,
        expectedWindowRevision: 0,
        addedSeconds: 60,
        reason: 'Stale reviewed request.',
        confirmation: {
          challengeId: c.challengeId,
          previousDeadline: c.fundingWindow.originalClosesAt,
          newDeadline: c.fundingWindow.effectiveClosesAt,
        },
      };
      await post(ownerContext, owner, path + '/extensions', input, randomUUID(), 409);
      await page.getByLabel('Additional funding seconds').fill('121');
      await expect(
        page.getByRole('checkbox', { name: /I reviewed this exact challenge/ }),
      ).toBeDisabled();
      await page.getByLabel('Additional funding seconds').fill('120');
      await page
        .getByLabel('Extension reason', { exact: false })
        .fill('Reviewed cumulative boundary.');
      await page.getByRole('checkbox', { name: /I reviewed this exact challenge/ }).check();
      await page.getByRole('button', { name: 'Confirm funding extension', exact: true }).click();
      await expect(
        page.getByText(/configured cumulative extension limit has been reached/),
      ).toBeVisible();
      assert.equal((await current()).fundingWindow.cumulativeSeconds, 180);
    },
  );
  await check(
    'expired discovery offers no fabricated broadcast; verified replacement authorizes continuation without completing performance or changing money',
    async () => {
      await runtime.replacement(inspection.id, creator);
      await new Promise((done) => setTimeout(done, 31000));
      await page.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
      await expect(
        page.getByText(/No current verified replacement stream is available/),
      ).toBeVisible();
      const replacement = await runtime.replacement(inspection.id, creator);
      await page.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
      await page.getByLabel('Verified replacement stream').selectOption(replacement);
      await page
        .getByLabel('Continuation reason', { exact: false })
        .fill('Reviewed verified replacement stream.');
      const submit = page.getByRole('button', {
        name: 'Confirm performance continuation',
        exact: true,
      });
      await expect(submit).toBeDisabled();
      await page
        .getByRole('checkbox', { name: /I reviewed this challenge, immutable original/ })
        .check();
      await submit.click();
      await expect(page.getByText(/The server recorded this request/)).toBeVisible();
      await expect
        .poll(async () => (await current()).performanceAuthority.broadcastId)
        .toBe(replacement);
      const c = await current(),
        e = await runtime.recoveryEvidence(inspection.id);
      assert.notEqual(c.performanceAuthority.originalBroadcastId, replacement);
      assert.equal(c.performanceRevision, 1);
      assert.deepEqual(e.challenge, initialEvidence.challenge);
      assert.deepEqual(e.funding, initialEvidence.funding);
      assert.equal(e.actions.length, 3);
      assert.equal(e.actions[2].kind, 'continuation');
      assert(e.actions[2].auditId && e.actions[2].proofSnapshotId && e.actions[2].outboxId);
    },
  );
  await check(
    'responsive recovery forms retain accessible labels, no overflow and unchecked confirmations after authoritative reload',
    async () => {
      await page.reload();
      await expect(
        page.getByRole('heading', { name: 'Audited recovery', exact: true }),
      ).toBeVisible();
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: 1100 });
        assert.equal(
          await page.evaluate(
            () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
          ),
          false,
        );
        await page.screenshot({
          path: join(evidence, `synthetic-recovery-${width}.png`),
          fullPage: true,
        });
      }
      const axe = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(
        axe.violations.map((v) => v.id),
        [],
      );
      assert.equal(
        await page.getByRole('checkbox', { name: /I reviewed this exact challenge/ }).isChecked(),
        false,
      );
      assert.equal(
        await page
          .getByRole('checkbox', { name: /I reviewed this challenge, immutable original/ })
          .isChecked(),
        false,
      );
    },
  );
  await check(
    'old recent-assurance cannot replay recovery automatically and expired staff authority clears private forms',
    async () => {
      await runtime.ageIdentity(owner.id);
      const c = await current();
      await post(
        ownerContext,
        owner,
        path + '/continuations',
        {
          challengeId: c.challengeId,
          expectedTicketRevision: c.ticketRevision,
          expectedContextRevision: c.contextRevision,
          expectedAuthorityRevision: c.authorityRevision,
          expectedFundingRevision: c.fundingRevision,
          expectedPerformanceRevision: c.performanceRevision,
          replacementBroadcastId: c.performanceAuthority.originalBroadcastId,
          reason: 'Old assurance rejection.',
          confirmation: {
            challengeId: c.challengeId,
            originalBroadcastId: c.performanceAuthority.originalBroadcastId,
            replacementBroadcastId: c.performanceAuthority.originalBroadcastId,
          },
        },
        randomUUID(),
        403,
      );
      const before = (await runtime.recoveryEvidence(inspection.id)).actions.length;
      await page.reload();
      assert.equal((await runtime.recoveryEvidence(inspection.id)).actions.length, before);
      await runtime.expire(owner.id);
      await page.reload();
      await expect(
        page.getByRole('heading', { name: 'Audited recovery', exact: true }),
      ).toHaveCount(0);
    },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(fingerprint(), sourceInputs);
  writeFileSync(
    join(evidence, 'acceptance.json'),
    JSON.stringify(
      {
        runId: api.runId,
        backend: JSON.parse(readFileSync('vendor/contracts/provenance.json')).sourceRevision,
        checks,
        passed: checks.length,
        sourceInputs,
        controlledEvidence:
          'Synthetic provider discovery, commercial policy and loopback identity only. Actual production browser, API, restricted admin SQL, Redis and audit; no external provider or email.',
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
        phase,
        name: error.name,
        prismaCode: error.code ?? null,
        sqlCode: error.meta?.driverAdapterError?.cause?.originalCode ?? null,
        sqlReason: /^[A-Za-z _]{1,160}$/.test(
          error.meta?.driverAdapterError?.cause?.originalMessage ?? '',
        )
          ? error.meta.driverAdapterError.cause.originalMessage
          : null,
        actualStatus: typeof error.actual === 'number' ? error.actual : null,
        expectedStatus: typeof error.expected === 'number' ? error.expected : null,
        matcher: error.matcherResult?.name,
        callsite: error.stack
          ?.split('\n')
          .find((line) => line.includes('local-staff-recovery-acceptance.mjs:')),
        setupOperation: error.setupOperation,
        setupStatus: error.setupStatus,
        setupCode: error.setupCode,
        passed: checks,
      },
      null,
      2,
    ),
  );
  console.error('Recovery acceptance failed at ' + phase + '. Private details omitted.');
} finally {
  await browser?.close();
  if (site) await closeServer(site.httpServer);
  if (publicSite) await closeServer(publicSite.httpServer);
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
