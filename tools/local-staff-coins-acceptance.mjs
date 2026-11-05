import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { build, preview } from 'vite';
import { chromium, expect, devices } from '@playwright/test';
import { startLocalApi } from './local-api.mjs';
const directory = resolve('artifacts.local/f09-06'),
  front = 'http://localhost:4176',
  admin = 'http://localhost:3320';
mkdirSync(directory, { recursive: true });
const fingerprint = () =>
  Object.fromEntries(
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8',
    })
      .split('\0')
      .filter(
        (file) =>
          file &&
          ((file.startsWith('src/') && !/\.(test|test-helper|test-support)\./.test(file)) ||
            /^(tools\/|package(?:-lock)?\.json|vite\.|staff\.html)/.test(file)),
      )
      .sort()
      .map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
  );
const sourceInputs = fingerprint(),
  checks = [];
let api,
  server,
  site,
  browser,
  phase = 'setup',
  result;
async function check(name, action) {
  phase = name;
  await action();
  checks.push(name);
  console.log('PASS ' + name);
}
try {
  api = await startLocalApi({
    backend: process.argv[2] ?? '../tmp/backend-f06-checkout',
    task: 'f09-06',
    coins: true,
    support: true,
    origins: ['http://127.0.0.1:4175'],
    port: 3310,
  });
  const fixture = api.coinFixture,
    d = fixture.durability;
  await fixture.configure();
  await d.adjust('100');
  await d.worker().tick();
  await fixture.templates.install('fixture_premium');
  const creator = await api.seedSession({ coinOwner: true, expiresInMs: 600000 }),
    runtime = await api.createStaffWorkbench();
  const network = { creatorCookie: false, referrer: false };
  server = createServer((request, response) => {
    network.creatorCookie ||= (request.headers.cookie ?? '').includes('darve_session=');
    network.referrer ||= Boolean(request.headers.referer);
    runtime.app(request, response);
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(3320, 'localhost', done);
  });
  process.env.STAFF_PUBLIC_APP_ENV = 'local';
  process.env.STAFF_PUBLIC_API_ORIGIN = admin;
  process.env.STAFF_PUBLIC_AUTHORIZATION_ENDPOINT = 'http://localhost:3321/authorize';
  const output = join(directory, 'runtime-build');
  await build({
    configFile: 'vite.staff.config.ts',
    envDir: false,
    mode: 'staff-coin-acceptance',
    logLevel: 'silent',
    build: { outDir: output, emptyOutDir: true },
  });
  site = await preview({
    configFile: 'vite.staff.config.ts',
    envDir: false,
    mode: 'staff-coin-acceptance',
    logLevel: 'silent',
    build: { outDir: output },
    preview: { host: 'localhost', port: 4176, strictPort: true },
  });
  browser = await chromium.launch();
  const owner = await runtime.seed('OWNER_ADMIN'),
    first = await runtime.seed(),
    second = await runtime.seed();
  const context = async (identity, options = {}) => {
    const c = await browser.newContext(options);
    await c.addCookies([
      {
        name: 'darve_staff_dev_session',
        value: identity.secret,
        url: admin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    return c;
  };
  const ownerContext = await context(owner, { viewport: { width: 1440, height: 1000 } }),
    supportContext = await context(first, devices['Pixel 7']),
    otherContext = await context(second),
    otherOwnerContext = await context(await runtime.seed('OWNER_ADMIN')),
    ownerPage = await ownerContext.newPage(),
    supportPage = await supportContext.newPage();
  const headers = (identity) => ({
    Origin: front,
    'X-Staff-CSRF': identity.csrf,
    'Idempotency-Key': randomUUID(),
  });
  const get = async (path, identity = ownerContext) => {
    const r = await identity.request.get(admin + path);
    assert.equal(r.status(), 200, path);
    return r.json();
  };
  const submit = async (label, reason = 'Reviewed isolated synthetic coin change') => {
    await ownerPage.getByLabel(label + ' reason').fill(reason);
    await ownerPage
      .getByRole('button', { name: 'Review ' + label.toLowerCase(), exact: true })
      .click();
    await expect(
      ownerPage.getByRole('button', { name: 'Confirm coin change', exact: true }),
    ).toBeDisabled();
    await ownerPage
      .getByRole('checkbox', { name: 'I reviewed this exact target, values, reason and revision.' })
      .check();
    await ownerPage.getByRole('button', { name: 'Confirm coin change', exact: true }).click();
  };
  await check(
    'actual enabled staff sessions retain independent owner and assigned-Support permissions',
    async () => {
      const a = await get('/admin/v1/session'),
        b = await get('/admin/v1/session', supportContext);
      assert(a.data.permissions.includes('coins.price'));
      assert(b.data.permissions.includes('coins.assigned.read'));
      assert(!b.data.permissions.includes('coins.read'));
      await ownerPage.goto(front + '/coins');
      await expect(
        ownerPage.getByRole('heading', { name: 'Coin administration', exact: true }),
      ).toBeVisible();
      await ownerPage.screenshot({
        path: join(directory, 'owner-configuration-synthetic.png'),
        fullPage: true,
      });
    },
  );
  await check(
    'reviewed configuration records one actual audit and canonical prospective reward revision',
    async () => {
      await ownerPage.getByLabel('10 qualifying suggestions reward').fill('11');
      await submit('Reward configuration');
      await expect(ownerPage.locator('.staff-coins-command').getByRole('status')).toContainText(
        'server recorded',
      );
      const config = await get('/admin/v1/coins/configuration');
      assert.equal(config.revision, 2);
      assert.equal(config.configurations[0].rewards['suggestions.10'], '11');
      assert.equal(
        (await fixture.staffEvidence(owner.id)).audits.filter(
          (row) => row.action === 'coins.configure',
        ).length,
        1,
      );
    },
  );
  await check(
    'reviewed adjustment stays pending until the independent Linux journal seals its canonical account',
    async () => {
      await ownerPage.goto(front + '/coins?view=account&owner=' + creator.userId);
      await ownerPage.getByLabel('Adjustment coins').fill('10');
      await submit('Balance adjustment');
      await expect(ownerPage.locator('.staff-coins-command').getByRole('status')).toContainText(
        'Synchronization is pending',
      );
      assert.equal(
        (await get('/admin/v1/coins/accounts/' + creator.userId)).state,
        'synchronization_pending',
      );
      await d.worker().tick();
      await ownerPage.getByRole('button', { name: 'Refresh coin records' }).click();
      await expect(ownerPage.getByText('110 coins', { exact: true }).first()).toBeVisible();
      assert.equal((await get('/admin/v1/coins/accounts/' + creator.userId)).state, 'synchronized');
    },
  );
  await check(
    'committed lost adjustment acknowledgement retries exact same key/body with no second audit or credit',
    async () => {
      const requests = [];
      let lost = true;
      await ownerPage.route('**/admin/v1/coins/accounts/*/adjustments', async (route) => {
        requests.push({
          key: route.request().headers()['idempotency-key'],
          body: route.request().postData(),
        });
        if (lost) {
          lost = false;
          await route.fetch();
          await route.abort('failed');
        } else await route.continue();
      });
      await ownerPage.getByLabel('Adjustment coins').fill('5');
      await submit('Balance adjustment', 'Reviewed isolated response-loss credit');
      await expect(ownerPage.locator('.staff-coins-command').getByRole('alert')).toContainText(
        'Result unconfirmed',
      );
      await d.worker().tick();
      await ownerPage
        .getByRole('checkbox', {
          name: 'I reviewed this exact target, values, reason and revision.',
        })
        .check();
      await ownerPage.getByRole('button', { name: 'Retry same coin change' }).click();
      await expect(ownerPage.locator('.staff-coins-command').getByRole('status')).toContainText(
        'Synchronization is pending',
      );
      await ownerPage.unroute('**/admin/v1/coins/accounts/*/adjustments');
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[0], requests[1]);
      const account = await get('/admin/v1/coins/accounts/' + creator.userId);
      assert.equal(account.balance, '115');
      assert.equal(
        (await fixture.staffEvidence(owner.id)).audits.filter(
          (row) => row.action === 'coins.adjust',
        ).length,
        2,
      );
    },
  );
  await check(
    'stale configuration review rejects without audit and rereads canonical revision',
    async () => {
      await ownerPage.goto(front + '/coins');
      await ownerPage.getByLabel('Reward configuration reason').fill('Stale synthetic review');
      await ownerPage
        .getByRole('button', { name: 'Review reward configuration', exact: true })
        .click();
      const current = await get('/admin/v1/coins/configuration');
      const response = await ownerContext.request.post(
        admin + '/admin/v1/coins/configuration-revisions',
        {
          headers: headers(owner),
          data: {
            expectedRevision: current.revision,
            active: false,
            rewards: current.configurations[0].rewards,
            reason: 'Competing isolated configuration',
            confirmation: { programId: current.programId },
          },
        },
      );
      assert.equal(response.status(), 200);
      await ownerPage
        .getByRole('checkbox', {
          name: 'I reviewed this exact target, values, reason and revision.',
        })
        .check();
      await ownerPage.getByRole('button', { name: 'Confirm coin change', exact: true }).click();
      await expect(ownerPage.locator('.staff-coins-command').getByRole('status')).toContainText(
        'reviewed version',
      );
      assert.equal(
        (await fixture.staffEvidence(owner.id)).audits.filter(
          (row) => row.action === 'coins.configure',
        ).length,
        2,
      );
    },
  );
  await check(
    'reviewed template prices and paginated staff history preserve exact zero and cursor authority',
    async () => {
      await ownerPage.goto(front + '/coins?view=prices&template=fixture_premium');
      await ownerPage.getByLabel('New template price in coins').fill('0');
      await submit('Template price', 'Reviewed isolated zero price');
      await expect(ownerPage.getByText('Current price: 0 coins · Price revision: 1')).toBeVisible();
      const history = await get('/admin/v1/coins/templates/fixture_premium/prices');
      assert.equal(history.data.items[0].amount, '0');
      const ledger = await get('/admin/v1/coins/accounts/' + creator.userId + '/ledger');
      assert(ledger.data.nextCursor);
      const foreign = await otherOwnerContext.request.get(
        admin +
          '/admin/v1/coins/accounts/' +
          creator.userId +
          '/ledger?cursor=' +
          encodeURIComponent(ledger.data.nextCursor),
      );
      assert.equal(foreign.status(), 400);
      assert.equal((await foreign.json()).error.code, 'INVALID_INPUT');
    },
  );
  let ticketId;
  await check(
    'assigned Support reads only the ticket summary and cannot open global coin tools or issue commands',
    async () => {
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
      const identity = await (
        await creatorContext.request.get(api.apiOrigin + '/api/session')
      ).json();
      const creatorAccount = await (
        await creatorContext.request.get(api.apiOrigin + '/api/coins/account')
      ).json();
      const redemption = await creatorContext.request.post(
        api.apiOrigin + '/api/templates/fixture_premium/redemptions',
        {
          headers: {
            Origin: 'http://127.0.0.1:4175',
            'X-CSRF-Token': identity.csrfToken,
            'Idempotency-Key': randomUUID(),
          },
          data: {
            expectedAccountRevision: creatorAccount.data.revision,
            priceRevision: 1,
            amount: '0',
            confirmation: { templateId: 'fixture_premium' },
          },
        },
      );
      assert.equal(redemption.status(), 200);
      await d.worker().tick();
      const response = await creatorContext.request.post(api.apiOrigin + '/api/support/tickets', {
        headers: {
          Origin: 'http://127.0.0.1:4175',
          'X-CSRF-Token': identity.csrfToken,
          'Idempotency-Key': randomUUID(),
        },
        data: { category: 'account', body: 'Isolated coin context question.', contexts: [] },
      });
      assert.equal(response.status(), 200);
      ticketId = (await response.json()).data.ticketId;
      for (const [identity, context] of [
        [first, supportContext],
        [second, otherContext],
      ]) {
        const available = await get('/admin/v1/support/availability', context);
        const set = await context.request.post(admin + '/admin/v1/support/availability', {
          headers: headers(identity),
          data: { available: true, expectedRevision: available.data.revision },
        });
        assert.equal(set.status(), 200);
      }
      await runtime.reassign(ticketId, first.id);
      await supportPage.goto(front + '/coins');
      await expect(
        supportPage.getByRole('heading', { name: 'Coin tools unavailable' }),
      ).toBeVisible();
      for (const path of [
        '/admin/v1/coins/configuration',
        '/admin/v1/coins/accounts/' + creator.userId,
        '/admin/v1/coins/templates',
      ])
        assert.equal((await supportContext.request.get(admin + path)).status(), 403);
      const config = await get('/admin/v1/coins/configuration');
      assert.equal(
        (
          await supportContext.request.post(admin + '/admin/v1/coins/configuration-revisions', {
            headers: headers(first),
            data: {
              expectedRevision: config.revision,
              active: false,
              rewards: config.configurations[0].rewards,
              reason: 'Denied Support write',
              confirmation: { programId: config.programId },
            },
          })
        ).status(),
        403,
      );
      await supportPage.goto(front + '/tickets/' + ticketId);
      await expect(
        supportPage.getByRole('heading', { name: 'Creator coin context' }),
      ).toBeVisible();
      await expect(supportPage.getByText('115 coins', { exact: true })).toBeVisible();
      const context = await get('/admin/v1/support/tickets/' + ticketId + '/coins', supportContext);
      assert(
        context.data.templates.some(
          (row) => row.id === 'fixture_premium' && row.owned && row.ownershipState === 'owned',
        ),
      );
      await expect(
        supportPage.getByText('Synthetic fixture_premium · owned · Available · Version 1'),
      ).toBeVisible();
      await supportPage.screenshot({
        path: join(directory, 'assigned-context-mobile-synthetic.png'),
        fullPage: true,
      });
      assert.deepEqual(Object.keys(context.data).sort(), [
        'balance',
        'progress',
        'progressCap',
        'templates',
      ]);
    },
  );
  await check(
    'actual reassignment removes mounted private coin context and reauthorizes the new assignee',
    async () => {
      await runtime.reassign(ticketId, second.id);
      await expect(supportPage.getByRole('heading', { name: 'Creator coin context' })).toHaveCount(
        0,
        { timeout: 15000 },
      );
      await expect(supportPage.getByText('115 coins', { exact: true })).toHaveCount(0);
      await expect(
        supportPage.getByText('Synthetic fixture_premium · owned · Available · Version 1'),
      ).toHaveCount(0);
      assert.equal(
        (
          await supportContext.request.get(
            admin + '/admin/v1/support/tickets/' + ticketId + '/coins',
          )
        ).status(),
        404,
      );
      assert.equal(
        (
          await otherContext.request.get(admin + '/admin/v1/support/tickets/' + ticketId + '/coins')
        ).status(),
        200,
      );
      assert.equal((await fixture.staffEvidence(first.id)).audits.length, 0);
    },
  );
  await check(
    'recent authentication denial clears review and no coin command resumes automatically',
    async () => {
      await ownerPage.goto(front + '/coins');
      await runtime.ageIdentity(owner.id);
      await submit('Reward configuration', 'Denied aged synthetic authentication');
      await expect(
        ownerPage.getByRole('heading', { name: 'Coin administration', exact: true }),
      ).toHaveCount(0);
      await expect(ownerPage.getByRole('button', { name: 'Verify identity again' })).toBeVisible();
      assert.equal(
        (await fixture.staffEvidence(owner.id)).audits.filter(
          (row) => row.action === 'coins.configure',
        ).length,
        2,
      );
    },
  );
  assert.equal(network.creatorCookie, false);
  assert.equal(network.referrer, false);
  assert.deepEqual(fingerprint(), sourceInputs);
  result = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    backend: api.source,
    sourceInputs,
    checks,
    syntheticRewardsPricesCreditIdentity: true,
    actualBrowserHTTPAuditAndLinuxJournal: true,
    network,
    createdAt: new Date().toISOString(),
  };
} catch (error) {
  writeFileSync(
    join(directory, 'failure.json'),
    JSON.stringify(
      {
        phase,
        name: error.name,
        message: String(error.message).replace(/[A-Za-z0-9_+/=-]{32,}/g, '[redacted]'),
        location: error.stack?.split('\n').slice(1, 4),
        checks,
      },
      null,
      2,
    ),
  );
  console.error('Staff coin acceptance failed at ' + phase + '; private bodies/proofs omitted.');
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const value of [site?.httpServer, server])
    if (value)
      await new Promise((done) => {
        value.close(done);
        value.closeAllConnections();
      });
  await api?.close();
  writeFileSync(
    join(directory, 'cleanup.json'),
    JSON.stringify({ ownedRuntimeClosed: true, runId: api?.runId }, null, 2),
  );
}
if (result) {
  writeFileSync(
    join(directory, 'acceptance.json'),
    JSON.stringify({ ...result, cleanupComplete: true }, null, 2),
  );
  console.log('Passed ' + checks.length + ' actual staff coin scenarios; owned runtime cleaned.');
}
