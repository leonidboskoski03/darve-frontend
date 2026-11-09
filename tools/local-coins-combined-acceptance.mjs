import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { build, preview } from 'vite';
import { chromium, devices, expect } from '@playwright/test';
import jsQR from 'jsqr';
import { startLocalApi } from './local-api.mjs';
import { verifyTemplateAsset } from './template-assets.mjs';
import {
  collectLifecycle,
  attachLifecycle,
  recoverLifecycle,
  fundAndDeclareLifecycle,
} from './local-staff-lifecycle-steps.mjs';

const lifecycle = process.argv.includes('--lifecycle');
const task = lifecycle ? 'f10-04' : 'f09-07';

// Exact F09-07 or F10-04. Real product entries/API/SQL/SSE/journal, controlled external facts.
const directory = resolve('artifacts.local/' + task),
  publicOrigin = 'http://127.0.0.1:4175',
  staffOrigin = 'http://localhost:4176',
  adminOrigin = 'http://localhost:3320';
mkdirSync(directory, { recursive: true });
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const fingerprint = () =>
  Object.fromEntries(
    git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
      .split('\0')
      .filter(
        (file) =>
          file &&
          ((/^(src|public)\//.test(file) &&
            !/(?:\.test|\.test-helper|\.test-support)\./.test(file)) ||
            /^(tools\/|assets\/overlay-templates\/|package(?:-lock)?\.json|vite\.|(?:index|staff|overlay)\.html)/.test(
              file,
            )),
      )
      .sort()
      .map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
  );
const sourceInputs = fingerprint(),
  checks = [],
  network = { adminCreatorCookie: false, adminStaffCookie: false, privateReferrer: false };
let api,
  server,
  publicSite,
  staffSite,
  browser,
  phase = 'setup',
  result;
const check = async (name, action) => {
  phase = name;
  await action();
  checks.push(name);
  console.log('PASS ' + name);
};
try {
  const asset = verifyTemplateAsset();
  // Reuse native OBS evidence only while every renderer/reader entry and its asset are unchanged.
  const nativeBaseline = 'ef746a5dbbe6db2f74c7f010394ff095bbb62c04';
  assert.equal(
    git(
      'diff',
      nativeBaseline,
      '--',
      'src/features/overlay-display',
      'src/entities/overlay-template',
      'src/services/overlay',
      'src/services/realtime',
      'src/app/overlay-main.tsx',
      'public/fonts',
    ),
    '',
    'Native OBS baseline changed; qualify native behavior again.',
  );
  assert.deepEqual(
    JSON.parse(
      git('show', nativeBaseline + ':assets/overlay-templates/darve-compact/manifest.json'),
    ),
    asset,
  );
  api = await startLocalApi({
    backend: process.argv[2] ?? '../tmp/backend-f06-checkout',
    task,
    checkout: lifecycle,
    coins: true,
    support: true,
    collection: true,
    review: true,
    terms: true,
    overlay: true,
    port: 3310,
    origins: [publicOrigin],
  });
  const fixture = api.coinFixture,
    d = fixture.durability,
    t = fixture.templates;
  await t.installManifest(asset);
  const creator = await api.seedSession({ coinOwner: true, expiresInMs: 600000 }),
    runtime = await api.createStaffWorkbench();
  server = createServer((request, response) => {
    const cookie = request.headers.cookie ?? '';
    network.adminCreatorCookie ||= cookie.includes('darve_session=');
    network.adminStaffCookie ||= cookie.includes('darve_staff_dev_session=');
    network.privateReferrer ||= Boolean(request.headers.referer);
    runtime.app(request, response);
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(3320, 'localhost', done);
  });
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  const publicOutput = join(directory, 'public-build'),
    staffOutput = join(directory, 'staff-build');
  await build({
    configFile: 'vite.config.ts',
    envDir: false,
    mode: 'coins-combined',
    logLevel: 'silent',
    build: { outDir: publicOutput, emptyOutDir: true },
  });
  publicSite = await preview({
    configFile: 'vite.config.ts',
    envDir: false,
    mode: 'coins-combined',
    logLevel: 'silent',
    build: { outDir: publicOutput },
    preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  });
  process.env.STAFF_PUBLIC_APP_ENV = 'local';
  process.env.STAFF_PUBLIC_API_ORIGIN = adminOrigin;
  process.env.STAFF_PUBLIC_AUTHORIZATION_ENDPOINT = 'http://localhost:3321/authorize';
  await build({
    configFile: 'vite.staff.config.ts',
    envDir: false,
    mode: 'coins-combined',
    logLevel: 'silent',
    build: { outDir: staffOutput, emptyOutDir: true },
  });
  staffSite = await preview({
    configFile: 'vite.staff.config.ts',
    envDir: false,
    mode: 'coins-combined',
    logLevel: 'silent',
    build: { outDir: staffOutput },
    preview: { host: 'localhost', port: 4176, strictPort: true },
  });
  browser = await chromium.launch();
  const owner = await runtime.seed('OWNER_ADMIN'),
    first = await runtime.seed(),
    second = await runtime.seed();
  const staffContext = async (identity, options = {}) => {
    const context = await browser.newContext(options);
    await context.addCookies([
      {
        name: 'darve_staff_dev_session',
        value: identity.secret,
        url: adminOrigin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    return context;
  };
  const ownerContext = await staffContext(owner, { viewport: { width: 1440, height: 1000 } }),
    supportContext = await staffContext(first, devices['Pixel 7']),
    nextSupport = await staffContext(second),
    creatorContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await creatorContext.addCookies([
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
    supportPage = await supportContext.newPage();
  const json = async (context, origin, path) => {
    const response = await context.request.get(origin + path);
    assert.equal(response.status(), 200, path);
    return response.json();
  };
  const creatorRead = async (path) => (await json(creatorContext, api.apiOrigin, path)).data;
  const staffRead = (path, context = ownerContext) => json(context, adminOrigin, path);
  const identity = await json(creatorContext, api.apiOrigin, '/api/session');
  const creatorHeaders = { Origin: publicOrigin, 'X-CSRF-Token': identity.csrfToken };
  const staffHeaders = (identity) => ({
    Origin: staffOrigin,
    'X-Staff-CSRF': identity.csrf,
    'Idempotency-Key': randomUUID(),
  });
  const refreshCoins = async () => {
    const button = creatorPage.getByRole('button', { name: 'Refresh coins', exact: true });
    await button.click();
    await expect(button).toBeEnabled();
  };
  const refreshTemplates = async () => {
    const button = creatorPage.getByRole('button', { name: 'Refresh ownership', exact: true });
    await button.click();
    await expect(button).toBeEnabled();
  };
  const submitOwner = async (label, reason) => {
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
    await expect(ownerPage.locator('.staff-coins-command').getByRole('status')).toContainText(
      'server recorded',
    );
  };
  const price = async (amount) => {
    await ownerPage.goto(staffOrigin + '/coins?view=prices&template=' + asset.id);
    await ownerPage.getByLabel('New template price in coins').fill(amount);
    await submitOwner('Template price', 'Reviewed isolated combined template price ' + amount);
  };
  const reviewRedemption = async () => {
    await creatorPage.getByRole('button', { name: 'Review Darve Compact', exact: true }).click();
    await expect(
      creatorPage.getByRole('heading', { name: 'Review redemption', exact: true }),
    ).toBeVisible();
  };
  const redeem = async () => {
    await creatorPage.getByRole('checkbox', { name: /I reviewed the/ }).check();
    await creatorPage.getByRole('button', { name: 'Confirm redemption', exact: true }).click();
  };
  const pick = async (name) => {
    await creatorPage.getByRole('button', { name: 'Select ' + name, exact: true }).click();
    await creatorPage
      .getByRole('checkbox', { name: 'I want to use this owned template for my OBS displays.' })
      .check();
    await creatorPage.getByRole('button', { name: 'Use this template', exact: true }).click();
    await expect(
      creatorPage.getByText('Template selection verified.', { exact: true }),
    ).toBeVisible();
  };
  let challenge, grant, display, displayContext, bindingBefore, layoutBefore, ticketId, adjustment;
  await check(
    'unconfigured creator state and independent Owner setup through actual product UI',
    async () => {
      await creatorPage.goto(publicOrigin + '/coins');
      await expect(creatorPage.getByText('Rewards not configured', { exact: true })).toBeVisible();
      const account = await creatorRead('/api/coins/account');
      assert.equal(account.state, 'unconfigured');
      assert.equal(account.balance, '0');
      assert.equal((await d.inspect()).ledger, 0);
      await ownerPage.goto(staffOrigin + '/coins');
      const fields = {
        'First successful collection reward': '20',
        'First funded goal reward': lifecycle ? '40' : '0',
        'First completion declaration reward': lifecycle ? '60' : '0',
        '10 qualifying suggestions reward': '0',
        '100 qualifying suggestions reward': '0',
        '1000 qualifying suggestions reward': '0',
      };
      for (const [name, value] of Object.entries(fields))
        await ownerPage.getByLabel(name, { exact: false }).fill(value);
      await ownerPage.getByRole('checkbox', { name: 'Enable future coin earning' }).check();
      await submitOwner('Reward configuration', 'Reviewed isolated combined prospective rewards');
      assert.equal((await staffRead('/admin/v1/coins/configuration')).revision, 1);
      await price('10');
    },
  );
  await check(
    'canonical collection earning remains unspendable after real journal append loss and restart',
    async () => {
      challenge = lifecycle
        ? await collectLifecycle({
            api,
            creator,
            page: creatorPage,
            context: creatorContext,
            origin: publicOrigin,
          })
        : await api.prepareTemplateOverlay(creator.secret);
      await creatorPage.goto(publicOrigin + '/coins');
      await refreshCoins();
      await expect(creatorPage.getByText('Verification pending', { exact: true })).toBeVisible();
      let failed = false;
      const fault = {
        ...d.journal,
        append: async (record) => {
          await d.journal.append(record);
          failed = true;
          throw Error('Injected combined earning acknowledgement loss');
        },
      };
      await assert.rejects(
        d.worker(fault).tick(),
        /Injected combined earning acknowledgement loss/,
      );
      assert(failed);
      await refreshCoins();
      assert.equal((await creatorRead('/api/coins/account')).spendableBalance, null);
      await d.journal.restart();
      await d.worker().tick();
      await d.worker().tick();
      await refreshCoins();
      await expect(creatorPage.locator('.coins-balances').getByRole('definition')).toHaveText([
        '20 coins',
        '20 coins',
      ]);
      const facts = await d.inspect();
      assert.equal(facts.qualifyingUnits, 1);
      assert.equal(facts.ledger, 1);
      assert.equal(facts.seals, 1);
      assert.equal(facts.account.claims.length, 1);
    },
  );
  await check(
    'staff price change invalidates the creator review without charging or entitlement',
    async () => {
      await creatorPage.goto(publicOrigin + '/templates');
      await reviewRedemption();
      await price('12');
      await redeem();
      await expect(
        creatorPage.getByRole('heading', { name: 'Price changed — review again', exact: true }),
      ).toBeVisible();
      assert.deepEqual(await t.inspect(), { redemptions: 0, entitlements: 0, debits: 0 });
      assert.equal((await creatorRead('/api/coins/account')).balance, '20');
      await refreshTemplates();
      await reviewRedemption();
    },
  );
  await check(
    'lost real redemption response retains one immutable request and once-only journal-backed ownership',
    async () => {
      const attempts = [];
      let drop = true,
        holdReads = true;
      await creatorPage.route(api.apiOrigin + '/api/**', async (route) => {
        const request = route.request(),
          path = new URL(request.url()).pathname;
        if (request.method() === 'POST' && path === '/api/templates/' + asset.id + '/redemptions') {
          attempts.push({ key: request.headers()['idempotency-key'], body: request.postData() });
          if (drop) {
            drop = false;
            const response = await route.fetch();
            assert.equal(response.status(), 200);
            await route.abort('failed');
            return;
          }
        }
        if (
          holdReads &&
          request.method() === 'GET' &&
          ['/api/coins/account', '/api/templates', '/api/template-entitlements'].includes(path)
        ) {
          await route.abort('failed');
          return;
        }
        await route.continue();
      });
      await redeem();
      await expect(
        creatorPage.getByRole('heading', { name: 'Redemption result unconfirmed', exact: true }),
      ).toBeVisible();
      assert.equal(attempts.length, 1);
      await creatorPage.getByRole('checkbox', { name: /I reviewed the/ }).check();
      await creatorPage.getByRole('button', { name: 'Retry same redemption', exact: true }).click();
      await expect(
        creatorPage.getByRole('heading', { name: 'Ownership verification pending', exact: true }),
      ).toBeVisible();
      assert.equal(attempts.length, 2);
      assert.deepEqual(attempts[0], attempts[1]);
      holdReads = false;
      await creatorPage.unroute(api.apiOrigin + '/api/**');
      await d.journal.restart();
      await d.worker().tick();
      await d.worker().tick();
      await refreshTemplates();
      await expect(
        creatorPage.getByRole('heading', { name: 'Ownership verified', exact: true }),
      ).toBeVisible();
      assert.deepEqual(await t.inspect(), { redemptions: 1, entitlements: 1, debits: 1 });
      assert.equal((await creatorRead('/api/coins/account')).spendableBalance, '8');
    },
  );
  await check(
    'owned compact selection reaches real OBS SSE with unchanged layout and challenge binding',
    async () => {
      const response = await creatorContext.request.post(api.apiOrigin + '/api/overlay-grants', {
        headers: creatorHeaders,
        data: {},
      });
      assert.equal(response.status(), 201);
      grant = (await response.json()).data;
      const selected = await creatorContext.request.put(
        api.apiOrigin + '/api/overlay-displays/' + grant.displayId + '/selection',
        {
          headers: creatorHeaders,
          data: {
            expectedVersion: grant.selection.version,
            roundId: challenge.roundId,
            challengeId: challenge.challengeId,
          },
        },
      );
      assert.equal(selected.status(), 200);
      displayContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      display = await displayContext.newPage();
      await display.goto(grant.presentationUrl);
      await expect(display.locator('.obs-stage')).toHaveAttribute('data-template', 'standalone');
      bindingBefore = await creatorRead('/api/overlay-displays/' + grant.displayId);
      layoutBefore = await creatorRead('/api/overlay-preferences?protocolVersion=2');
      await pick('Darve Compact');
      await expect(display.locator('.obs-stage')).toHaveAttribute('data-template', 'compact');
      await expect(display.locator('.obs-card')).toBeVisible();
      assert.deepEqual(
        await creatorRead('/api/overlay-displays/' + grant.displayId),
        bindingBefore,
      );
      const layout = await creatorRead('/api/overlay-preferences?protocolVersion=2');
      assert.equal(layout.version, layoutBefore.version);
      assert.deepEqual(layout.styles, layoutBefore.styles);
      assert.equal((await creatorRead('/api/coins/account')).balance, '8');
    },
  );
  await check(
    'fresh OBS reader reload and independently decoded QR retain the canonical public destination',
    async () => {
      const fresh = await browser.newContext({ viewport: { width: 1920, height: 1080 } }),
        page = await fresh.newPage();
      await page.goto(grant.presentationUrl);
      await expect(page.locator('.obs-stage')).toHaveAttribute('data-template', 'compact');
      await page.reload();
      await expect(page.locator('.obs-card')).toBeVisible();
      const svg = await page
        .getByRole('img', { name: 'Scan to view this challenge' })
        .evaluate((node) => new globalThis.XMLSerializer().serializeToString(node));
      for (const size of [150, 100]) {
        const pixels = await page.evaluate(
          async ({ svg, size }) => {
            const image = new globalThis.Image();
            image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
            await image.decode();
            const canvas = globalThis.document.createElement('canvas');
            canvas.width = canvas.height = size;
            const context = canvas.getContext('2d');
            context.imageSmoothingEnabled = false;
            context.drawImage(image, 0, 0, size, size);
            return Array.from(context.getImageData(0, 0, size, size).data);
          },
          { svg, size },
        );
        assert.equal(jsQR(new Uint8ClampedArray(pixels), size, size)?.data, challenge.publicUrl);
      }
      assert.equal(
        await page.evaluate(
          () => globalThis.getComputedStyle(globalThis.document.body).backgroundColor,
        ),
        'rgba(0, 0, 0, 0)',
      );
      await page.locator('.obs-card').screenshot({
        path: join(directory, 'compact-combined-synthetic.png'),
        omitBackground: true,
      });
      await fresh.close();
      const denied = await displayContext.request.post(
        api.apiOrigin + '/api/template-preferences',
        {
          headers: { Origin: publicOrigin },
          data: { expectedRevision: 1, templateId: 'standalone' },
        },
      );
      assert([401, 403].includes(denied.status()));
    },
  );
  await check(
    'audited Owner adjustment reconciles independently in creator balance and staff history',
    async () => {
      await ownerPage.goto(staffOrigin + '/coins?view=account&owner=' + creator.userId);
      await ownerPage.getByLabel('Adjustment coins').fill('5');
      await ownerPage
        .getByLabel('Balance adjustment reason')
        .fill('Reviewed isolated combined correction');
      await ownerPage
        .getByRole('button', { name: 'Review balance adjustment', exact: true })
        .click();
      await ownerPage
        .getByRole('checkbox', {
          name: 'I reviewed this exact target, values, reason and revision.',
        })
        .check();
      const adjustmentRequest = lifecycle
        ? ownerPage.waitForRequest(
            (request) => request.method() === 'POST' && request.url().endsWith('/adjustments'),
          )
        : null;
      await ownerPage.getByRole('button', { name: 'Confirm coin change', exact: true }).click();
      if (adjustmentRequest) adjustment = (await adjustmentRequest).postDataJSON();
      await expect(ownerPage.locator('.staff-coins-command').getByRole('status')).toContainText(
        'Synchronization is pending',
      );
      await creatorPage.goto(publicOrigin + '/coins');
      await expect(creatorPage.getByText('Verification pending', { exact: true })).toBeVisible();
      await d.worker().tick();
      await refreshCoins();
      await expect(creatorPage.locator('.coins-balances').getByRole('definition')).toHaveText([
        '13 coins',
        '13 coins',
      ]);
      const history = await staffRead('/admin/v1/coins/accounts/' + creator.userId + '/ledger');
      assert.equal(history.data.items[0].delta, '5');
      const evidence = await fixture.staffEvidence(owner.id);
      assert.equal(evidence.audits.filter((row) => row.action === 'coins.adjust').length, 1);
    },
  );
  await check(
    'creator ticket and assigned Support summary share verified coins and ownership without owner authority',
    async () => {
      await creatorPage.goto(publicOrigin + '/support');
      await creatorPage.getByRole('button', { name: 'New ticket', exact: true }).click();
      await creatorPage.getByLabel('Category', { exact: true }).selectOption('account');
      await creatorPage
        .getByLabel('Message (required)', { exact: true })
        .fill('Synthetic combined coin and template question.');
      await creatorPage.getByRole('button', { name: 'Create ticket', exact: true }).click();
      await expect(creatorPage).toHaveURL(/\/support\/[0-9a-f-]{36}$/i);
      ticketId = new URL(creatorPage.url()).pathname.split('/').at(-1);
      if (lifecycle) await attachLifecycle({ page: creatorPage, challenge });
      for (const [identity, context] of [
        [first, supportContext],
        [second, nextSupport],
      ]) {
        const current = await staffRead('/admin/v1/support/availability', context);
        const response = await context.request.post(
          adminOrigin + '/admin/v1/support/availability',
          {
            headers: staffHeaders(identity),
            data: { available: true, expectedRevision: current.data.revision },
          },
        );
        assert.equal(response.status(), 200);
      }
      await runtime.reassign(ticketId, first.id);
      await supportPage.goto(staffOrigin + '/tickets/' + ticketId);
      await expect(
        supportPage.getByRole('heading', { name: 'Creator coin context', exact: true }),
      ).toBeVisible();
      await expect(supportPage.getByText('13 coins', { exact: true })).toBeVisible();
      await expect(
        supportPage.getByText('Darve Compact · owned · Available · Version 1', { exact: true }),
      ).toBeVisible();
      const summary = (
        await staffRead('/admin/v1/support/tickets/' + ticketId + '/coins', supportContext)
      ).data;
      assert.deepEqual(Object.keys(summary).sort(), [
        'balance',
        'progress',
        'progressCap',
        'templates',
      ]);
      assert.equal(
        (await supportContext.request.get(adminOrigin + '/admin/v1/coins/configuration')).status(),
        403,
      );
      if (lifecycle) {
        const denied = await supportContext.request.post(
          adminOrigin + '/admin/v1/coins/accounts/' + creator.userId + '/adjustments',
          { headers: staffHeaders(first), data: adjustment },
        );
        assert.equal(denied.status(), 403);
        assert.equal((await creatorRead('/api/coins/account')).balance, '13');
      }
    },
  );
  if (lifecycle) {
    const recovery = await recoverLifecycle({
      runtime,
      challenge,
      ticketId,
      ownerContext,
      ownerPage,
      support: first,
      supportContext,
      staffOrigin,
      adminOrigin,
      check,
    });
    await fundAndDeclareLifecycle({
      api,
      runtime,
      creator,
      challenge,
      ticketId,
      creatorContext,
      creatorPage,
      ownerPage,
      origin: publicOrigin,
      staffOrigin,
      browser,
      d,
      creatorRead,
      check,
    });
    await check(
      'expired recent staff assurance cannot extend this challenge and reload never replays a recovery',
      async () => {
        await runtime.ageIdentity(owner.id);
        const before = await runtime.recoveryEvidence(challenge.challengeId);
        const denied = await ownerContext.request.post(
          adminOrigin + recovery.path + '/extensions',
          { headers: staffHeaders(owner), data: recovery.reviewed },
        );
        assert.equal(denied.status(), 403);
        await ownerPage.reload();
        assert.deepEqual(
          (await runtime.recoveryEvidence(challenge.challengeId)).actions,
          before.actions,
        );
        const sources = await fixture.lifecycleEvidence();
        assert.equal(sources.facts.length, 3);
        assert.equal(
          sources.facts.find((row) => row.kind === 'collection').roundId,
          challenge.roundId,
        );
        assert.equal(
          sources.facts.find((row) => row.kind === 'funding').sourceId,
          challenge.challengeId,
        );
        assert.equal(
          sources.facts.find((row) => row.kind === 'completion').sourceId,
          sources.declarations[0].id,
        );
        assert.equal(sources.declarations[0].challengeId, challenge.challengeId);
        assert.deepEqual(sources.claims.map((row) => row.mission).sort(), [
          'collection.first_success',
          'completion.first_declaration',
          'funding.first_goal',
        ]);
      },
    );
  }
  const finalBalance = lifecycle ? '113' : '13';
  const finalLedger = lifecycle ? 5 : 3;
  await check(
    'reassignment removes the mounted coin/template context and authorizes only the current assignee',
    async () => {
      await runtime.reassign(ticketId, second.id);
      await expect(
        supportPage.getByRole('heading', { name: 'Creator coin context', exact: true }),
      ).toHaveCount(0, { timeout: 15000 });
      await expect(supportPage.getByText('13 coins', { exact: true })).toHaveCount(0);
      assert.equal(
        (
          await supportContext.request.get(
            adminOrigin + '/admin/v1/support/tickets/' + ticketId + '/coins',
          )
        ).status(),
        404,
      );
      const { data } = await staffRead(
        '/admin/v1/support/tickets/' + ticketId + '/coins',
        nextSupport,
      );
      assert.equal(data.balance, finalBalance);
      assert.equal((await fixture.staffEvidence(first.id)).audits.length, 0);
    },
  );
  await check(
    'withdrawal preserves ownership while OBS hides the asset and explicit standalone fallback charges nothing',
    async () => {
      await t.withdraw(asset.id, 1);
      await expect(display.locator('.obs-card')).toHaveCount(0);
      await expect(display.getByRole('img', { name: 'Scan to view this challenge' })).toHaveCount(
        0,
      );
      const entitlements = await creatorRead('/api/template-entitlements');
      assert(
        entitlements.templates.some(
          (row) => row.id === asset.id && row.ownershipState === 'owned' && !row.available,
        ),
      );
      const summary = (
        await staffRead('/admin/v1/support/tickets/' + ticketId + '/coins', nextSupport)
      ).data;
      assert(summary.templates.some((row) => row.id === asset.id && row.owned && !row.available));
      await creatorPage.goto(publicOrigin + '/templates');
      await pick('Standalone');
      await expect(display.locator('.obs-stage')).toHaveAttribute('data-template', 'standalone');
      await expect(display.locator('.obs-card')).toBeVisible();
      assert.equal((await creatorRead('/api/coins/account')).balance, finalBalance);
      assert.deepEqual(await t.inspect(), { redemptions: 1, entitlements: 1, debits: 1 });
    },
  );
  await check(
    'unavailable consumer binding hides amounts and recovers through deliberate canonical reads',
    async () => {
      await creatorPage.goto(publicOrigin + '/coins');
      await fixture.unavailable(true);
      await refreshCoins();
      await expect(creatorPage.locator('.coins-balances')).toHaveCount(0);
      assert.equal(
        (await creatorContext.request.get(api.apiOrigin + '/api/coins/account')).status(),
        503,
      );
      await fixture.unavailable(false);
      await refreshCoins();
      await expect(creatorPage.locator('.coins-balances').getByRole('definition')).toHaveText([
        finalBalance + ' coins',
        finalBalance + ' coins',
      ]);
    },
  );
  await check(
    'reader revocation and independent sign-out clear private presentation without altering coin records',
    async () => {
      assert.equal(
        (
          await creatorContext.request.delete(api.apiOrigin + '/api/overlay-grants/' + grant.id, {
            headers: creatorHeaders,
          })
        ).status(),
        204,
      );
      await display.reload();
      await expect(display.locator('.obs-card')).toHaveCount(0);
      await creatorPage.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect.poll(() => api.revoked(creator.sessionId)).toBe(true);
      await expect(creatorPage.locator('.coins-balances')).toHaveCount(0);
      const current = await staffRead('/admin/v1/coins/accounts/' + creator.userId);
      assert.equal(current.balance, finalBalance);
      const facts = await d.inspect();
      assert.equal(facts.ledger, finalLedger);
      assert.equal(facts.seals, finalLedger);
      assert.equal((await d.journal.read()).length, finalLedger);
      const audits = await fixture.staffEvidence(owner.id);
      assert.equal(audits.audits.length, 4);
    },
  );
  assert(network.adminStaffCookie);
  assert.equal(network.adminCreatorCookie, false);
  assert.equal(network.privateReferrer, false);
  assert.deepEqual(fingerprint(), sourceInputs);
  result = {
    head: git('rev-parse', 'HEAD'),
    backend: api.source,
    sourceInputs,
    checks,
    asset,
    nativeBaseline,
    nativeSourceUnchanged: true,
    newNativeOBSObservation: false,
    nativeEvidence:
      'F09-05 OBS and F07 physical QR evidence retained; no new native/phone observation',
    actualProductBrowserHTTP_SQL_SSE_Journal: true,
    syntheticProvidersModelsRewardsPricesIdentity: true,
    task,
    connectedLifecycle: lifecycle,
    finalBalance,
    finalLedger,
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
        detail: String(error.message)
          .replace(/#grant(?:Id)?=[^\s]+/g, '[private grant]')
          .replace(/[A-Za-z0-9_+/=-]{32,}/g, '[redacted]'),
        location: error.stack
          ?.split('\n')
          .filter((line) => /^\s+at /.test(line))
          .slice(0, 3),
        checks,
      },
      null,
      2,
    ),
  );
  console.error('Combined coin acceptance failed at ' + phase + '; private bodies/proofs omitted.');
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const ownedServer of [publicSite?.httpServer, staffSite?.httpServer, server])
    if (ownedServer)
      await new Promise((done) => {
        ownedServer.close(done);
        ownedServer.closeAllConnections();
      });
  await api?.close();
  writeFileSync(
    join(directory, 'cleanup.json'),
    JSON.stringify({ runId: api?.runId, ownedRuntimeClosed: true }, null, 2),
  );
}
if (result) {
  writeFileSync(
    join(directory, 'acceptance.json'),
    JSON.stringify({ ...result, cleanupComplete: true }, null, 2),
  );
  console.log(
    'Passed ' + checks.length + ' combined coin/template scenarios; owned runtime cleaned.',
  );
}
