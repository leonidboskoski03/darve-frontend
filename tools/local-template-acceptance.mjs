import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build, preview } from 'vite';
import { chromium, devices, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startLocalApi } from './local-api.mjs';
const evidence = resolve('artifacts.local/f09-04'),
  origin = 'http://127.0.0.1:4175';
mkdirSync(evidence, { recursive: true });
const fingerprint = () =>
  Object.fromEntries(
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8',
    })
      .split('\0')
      .filter(
        (file) =>
          file &&
          ((/^src\//.test(file) && !/(\.test|\.test-helper)\./.test(file)) ||
            /^(?:tools\/(?:local-(?:api|coin-fixture|template-acceptance)|linux-coin-journal(?:-entry)?)\.mjs|vite\.config\.ts|package(?:-lock)?\.json)$/.test(
              file,
            )),
      )
      .sort()
      .map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
  );
const sourceInputs = fingerprint(),
  checks = [],
  errors = [];
let api,
  site,
  browser,
  phase = 'setup',
  result;
async function check(name, fn) {
  phase = name;
  const start = performance.now();
  await fn();
  checks.push({ name, passed: true, durationMs: Math.round(performance.now() - start) });
  console.log('PASS ' + name);
}
try {
  api = await startLocalApi({
    backend: process.argv[2] ?? '../tmp/backend-f06-checkout',
    task: 'f09-04',
    coins: true,
    origins: [origin],
    port: 3310,
  });
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  const outDir = join(evidence, 'public-build');
  await build({
    configFile: 'vite.config.ts',
    envDir: false,
    mode: 'template-acceptance',
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  site = await preview({
    configFile: 'vite.config.ts',
    envDir: false,
    mode: 'template-acceptance',
    logLevel: 'silent',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  });
  browser = await chromium.launch();
  const fixture = api.coinFixture,
    d = fixture.durability,
    t = fixture.templates;
  assert(d && t);
  const actor = await api.seedSession({ coinOwner: true, expiresInMs: 600_000 });
  const cookie = (secret) => ({
    name: 'darve_session',
    value: secret,
    url: api.apiOrigin,
    httpOnly: true,
    sameSite: 'Lax',
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  await context.addCookies([cookie(actor.secret)]);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.name));
  const premium = 'fixture_premium',
    other = 'fixture_other',
    expensive = 'fixture_expensive';
  const read = async (path, ctx = context) => {
    const response = await ctx.request.get(api.apiOrigin + path, { headers: { Origin: origin } });
    assert.equal(response.status(), 200);
    return response.json();
  };
  const session = await read('/api/session');
  const command = async (id, input, key = randomUUID()) =>
    context.request.post(api.apiOrigin + '/api/templates/' + id + '/redemptions', {
      headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': key },
      data: input,
    });
  const refresh = async (p = page) => {
    const button = p.getByRole('button', { name: 'Refresh ownership', exact: true });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(button).toBeEnabled();
  };
  const review = async (p, id) => {
    await p.getByRole('button', { name: 'Review Synthetic ' + id, exact: true }).click();
    await expect(p.getByRole('heading', { name: 'Review redemption', exact: true })).toBeVisible();
  };
  const confirm = async (p = page) => {
    await p.getByRole('checkbox', { name: /I reviewed the/ }).check();
    await p.getByRole('button', { name: 'Confirm redemption', exact: true }).click();
  };
  await check(
    'real catalogue and balances use synthetic manifests and audited verified credit',
    async () => {
      await fixture.configure();
      await t.install(premium);
      await t.price(premium, '25', 0);
      await d.adjust('100');
      await d.worker().tick();
      await page.goto(origin + '/templates');
      await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible();
      await expect(page.getByRole('definition')).toHaveText('100');
      await expect(page.getByText('Not owned', { exact: true })).toBeVisible();
      await expect(page.getByText('OBS display support pending.', { exact: false })).toBeVisible();
      assert.deepEqual(await t.inspect(), { redemptions: 0, entitlements: 0, debits: 0 });
    },
  );
  await check(
    'real price change rejects the old quote without debit and requires new review',
    async () => {
      await review(page, premium);
      await t.price(premium, '30', 1);
      await page.screenshot({
        path: join(evidence, 'synthetic-redemption-review-desktop.png'),
        fullPage: true,
      });
      await confirm();
      await expect(
        page.getByRole('heading', { name: 'Price changed — review again' }),
      ).toBeVisible();
      assert.deepEqual(await t.inspect(), { redemptions: 0, entitlements: 0, debits: 0 });
      await review(page, premium);
      await expect(page.getByRole('checkbox', { name: /I reviewed the/ })).not.toBeChecked();
      await expect(page.getByRole('checkbox', { name: /I reviewed the/ })).toHaveAccessibleName(
        /30 coin cost/,
      );
    },
  );
  let competitor;
  await check(
    'two real browser intents produce one debit, one entitlement and an already-owned zero charge',
    async () => {
      competitor = await context.newPage();
      await competitor.goto(origin + '/templates');
      await review(competitor, premium);
      await confirm();
      await expect(
        page.getByRole('heading', { name: 'Ownership verification pending' }),
      ).toBeVisible();
      const responsePromise = competitor.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith('/redemptions'),
      );
      await confirm(competitor);
      const response = await responsePromise;
      assert.equal(response.status(), 200);
      assert.deepEqual((await response.json()).data, {
        templateId: premium,
        state: 'already_owned',
        charged: '0',
      });
      assert.deepEqual(await t.inspect(), { redemptions: 1, entitlements: 1, debits: 1 });
      const facts = await d.inspect();
      assert.equal(facts.account.balance, '70');
      assert.equal((await read('/api/coins/account')).data.spendableBalance, null);
    },
  );
  await check(
    'real Linux append interruption and restart retain pending ownership then seal once',
    async () => {
      const lostAck = {
        ...d.journal,
        append: async (record) => {
          await d.journal.append(record);
          throw Error('Injected redemption acknowledgement loss');
        },
      };
      await assert.rejects(d.worker(lostAck).tick(), /Injected redemption acknowledgement loss/);
      await refresh();
      await expect(page.getByText('Ownership pending', { exact: true })).toBeVisible();
      await d.journal.restart();
      await d.worker().tick();
      await d.worker().tick();
      await refresh();
      await refresh(competitor);
      await expect(
        page.getByRole('heading', { name: 'Ownership verified', exact: true }),
      ).toBeVisible();
      await expect(
        competitor.getByRole('heading', { name: 'Ownership verified', exact: true }),
      ).toBeVisible();
      const facts = await d.inspect();
      assert.equal(facts.seals, 2);
      assert.equal(facts.ledger, 2);
      assert.equal((await read('/api/coins/account')).data.spendableBalance, '70');
      assert.equal((await d.journal.read()).length, 2);
      assert.deepEqual(await t.inspect(), { redemptions: 1, entitlements: 1, debits: 1 });
      await competitor.close();
    },
  );
  await check(
    'lost actual HTTP acknowledgement retries exact held key/body with no duplicate redemption',
    async () => {
      await t.install(other);
      await t.price(other, '10', 0);
      await refresh();
      await review(page, other);
      let drop = true,
        holdReads = true;
      const attempts = [];
      await page.route(api.apiOrigin + '/api/**', async (route) => {
        const request = route.request(),
          path = new URL(request.url()).pathname;
        if (request.method() === 'POST' && path === '/api/templates/' + other + '/redemptions') {
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
      await confirm();
      await expect(
        page.getByRole('heading', { name: 'Redemption result unconfirmed' }),
      ).toBeVisible();
      await expect(page.getByRole('checkbox', { name: /I reviewed the/ })).not.toBeChecked();
      assert.equal(attempts.length, 1);
      await page.getByRole('checkbox', { name: /I reviewed the/ }).check();
      await page.getByRole('button', { name: 'Retry same redemption' }).click();
      await expect(
        page.getByRole('heading', { name: 'Ownership verification pending' }),
      ).toBeVisible();
      assert.equal(attempts.length, 2);
      assert.deepEqual(attempts[1], attempts[0]);
      assert.deepEqual(await t.inspect(), { redemptions: 2, entitlements: 2, debits: 2 });
      holdReads = false;
      await page.unroute(api.apiOrigin + '/api/**');
      await d.worker().tick();
      await refresh();
      await expect(
        page.getByRole('heading', { name: 'Ownership verified', exact: true }),
      ).toBeVisible();
      assert.equal((await read('/api/coins/account')).data.spendableBalance, '60');
    },
  );
  await check(
    'actual insufficient balance is rejected without ledger or ownership change',
    async () => {
      await t.install(expensive);
      await t.price(expensive, '999', 0);
      await refresh();
      await expect(
        page.getByRole('button', { name: 'Review Synthetic ' + expensive, exact: true }),
      ).toBeDisabled();
      const account = (await read('/api/coins/account')).data;
      const response = await command(expensive, {
        expectedAccountRevision: account.revision,
        priceRevision: 1,
        amount: '999',
        confirmation: { templateId: expensive },
      });
      assert.equal(response.status(), 409);
      assert.equal((await response.json()).error.code, 'INSUFFICIENT_BALANCE');
      assert.deepEqual(await t.inspect(), { redemptions: 2, entitlements: 2, debits: 2 });
    },
  );
  await check(
    'ownership survives future asset version, withdrawal, private reload and URL filter',
    async () => {
      await t.install(premium, 2);
      await t.withdraw(premium, 2);
      await refresh();
      await page.getByRole('link', { name: 'Owned templates', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Synthetic ' + premium, exact: true }),
      ).toBeVisible();
      await expect(page.getByText('Version 2 · 30 coins', { exact: true })).toBeVisible();
      await expect(page.getByText('Unavailable', { exact: true })).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole('heading', { name: 'Synthetic ' + premium, exact: true }),
      ).toBeVisible();
      const rows = (await read('/api/template-entitlements')).data.templates;
      assert(
        rows.some(
          (row) =>
            row.id === premium &&
            row.owned &&
            row.ownershipState === 'owned' &&
            !row.available &&
            row.assetVersion === 2,
        ),
      );
      assert.deepEqual(await t.inspect(), { redemptions: 2, entitlements: 2, debits: 2 });
    },
  );
  await check(
    'real mobile accessibility, exact ledger and different creator isolation',
    async () => {
      const mobile = await browser.newContext({ ...devices['Pixel 7'], reducedMotion: 'reduce' });
      await mobile.addCookies([cookie(actor.secret)]);
      const p = await mobile.newPage();
      await p.goto(origin + '/templates');
      await expect(p.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible();
      assert.equal(
        await p.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
        ),
        true,
      );
      assert.deepEqual((await new AxeBuilder({ page: p }).analyze()).violations, []);
      await p.screenshot({ path: join(evidence, 'synthetic-template-mobile.png'), fullPage: true });
      await mobile.close();
      await page.screenshot({
        path: join(evidence, 'synthetic-template-desktop.png'),
        fullPage: true,
      });
      let cursor = null;
      const ledger = [];
      do {
        const data = (
          await read('/api/coins/ledger' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''))
        ).data;
        ledger.push(...data.items);
        cursor = data.nextCursor;
      } while (cursor);
      assert.deepEqual(
        ledger.map((row) => [row.kind, row.delta, row.balance]),
        [
          ['redemption', '-10', '60'],
          ['redemption', '-30', '70'],
          ['adjustment', '100', '100'],
        ],
      );
      const outsider = await api.seedSession({ expiresInMs: 60_000 }),
        otherContext = await browser.newContext();
      await otherContext.addCookies([cookie(outsider.secret)]);
      const owned = (await read('/api/template-entitlements', otherContext)).data.templates;
      assert.deepEqual(
        owned.map((row) => row.id),
        ['standalone'],
      );
      await otherContext.close();
    },
  );
  await check('real logout removes private screen and revokes creator session', async () => {
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Template catalogue', exact: true }),
    ).toHaveCount(0);
    await expect.poll(() => api.revoked(actor.sessionId)).toBe(true);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.deepEqual(errors, []);
  });
  assert.deepEqual(fingerprint(), sourceInputs);
  result = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    backendPin: api.source,
    sourceInputs,
    checks,
    syntheticAssetsPricesAndAdjustment: true,
    realRedemptionAndJournal: true,
    realPremiumRenderer: false,
    finalBalance: '60',
    redemptions: 2,
    entitlements: 2,
    debits: 2,
    createdAt: new Date().toISOString(),
  };
} catch (error) {
  const detail = String(error.message)
    .replace(/(?:postgres(?:ql)?|redis):\/\/[^\s]+/g, '[private storage]')
    .replace(/[A-Za-z0-9_+/=-]{32,}/g, '[redacted]');
  writeFileSync(
    join(evidence, 'failure.json'),
    JSON.stringify(
      { phase, name: error.name, detail, location: error.stack?.split('\n').slice(1, 6), checks },
      null,
      2,
    ),
  );
  console.error('F09-04 failed during ' + phase + ': ' + detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (site)
    await new Promise((done) => {
      site.httpServer.close(done);
      site.httpServer.closeAllConnections();
    });
  await api?.close();
}
if (result) {
  writeFileSync(
    join(evidence, 'acceptance.json'),
    JSON.stringify({ ...result, cleanupComplete: true }, null, 2),
  );
  console.log(
    'Passed ' +
      checks.length +
      ' actual template browser/API/SQL/Linux-journal scenarios; owned runtime cleaned.',
  );
}
