import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build, preview } from 'vite';
import { chromium, devices, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startLocalApi } from './local-api.mjs';

const evidence = resolve('artifacts.local/f09-03'),
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
            /^(?:tools\/(?:local-(?:api|collection-fixture|review-fixture|coin-fixture|creator-coins-acceptance)|linux-coin-journal(?:-entry)?)\.mjs|vite\.config\.ts|package(?:-lock)?\.json)$/.test(
              file,
            )),
      )
      .sort()
      .map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
  );
const sourceInputs = fingerprint(),
  checks = [],
  errors = [],
  mutations = [];
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
    task: 'f09-03',
    coins: true,
    collection: true,
    review: true,
    terms: true,
    origins: [origin],
    port: 3310,
  });
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  const outDir = join(evidence, 'public-build');
  await build({
    configFile: 'vite.config.ts',
    envDir: false,
    mode: 'creator-coins-acceptance',
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  site = await preview({
    configFile: 'vite.config.ts',
    envDir: false,
    mode: 'creator-coins-acceptance',
    logLevel: 'silent',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  });
  browser = await chromium.launch();
  const fixture = api.coinFixture,
    d = fixture.durability;
  assert(d);
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
  page.on('pageerror', (e) => errors.push(e.name));
  page.on('request', (r) => {
    if (r.method() !== 'GET' && /\/api\/(?:coins|templates)/.test(r.url()))
      mutations.push(r.method());
  });
  const balance = page.getByRole('region', { name: 'Your balance', exact: true });
  const refresh = async () => {
    await expect(page.getByRole('button', { name: 'Refresh coins', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Refresh coins', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Refresh coins', exact: true })).toBeEnabled();
  };
  await check('unconfigured creator screen uses actual state and unknown rewards', async () => {
    await page.goto(origin + '/coins');
    await expect(page.getByRole('heading', { name: 'Coins', exact: true })).toBeVisible();
    await expect(page.getByText('Rewards not configured', { exact: true })).toBeVisible();
    await expect(page.getByText('Current reward: Not configured', { exact: true })).toHaveCount(6);
    await expect(
      page.getByRole('heading', { name: 'No coin activity yet', exact: true }),
    ).toBeVisible();
    await expect(balance.getByRole('definition')).toHaveText(['0 coins', '0 coins']);
  });
  await check('configured empty account remains zero without fabricated earnings', async () => {
    await fixture.configure();
    await refresh();
    await expect(page.getByText('Up to date', { exact: true })).toBeVisible();
    await expect(balance.getByRole('definition')).toHaveText(['0 coins', '0 coins']);
    await expect(page.getByText('Current reward: 20 coins', { exact: true })).toBeVisible();
  });
  await check(
    'canonical controlled collection publication counts distinct viewer/idea facts',
    async () => {
      const texts = [...Array(11).fill('Draw a cat'), 'Sing a short song'];
      const authors = [
        'viewer-0',
        ...Array.from({ length: 10 }, (_, i) => 'viewer-' + i),
        'viewer-0',
      ];
      const round = await api.collectionFixture.collectForCoins(actor.secret, texts, authors);
      await api.reviewFixture.publish(actor.userId, round);
      const state = await d.inspect();
      assert.equal(state.capturedFacts, 1);
      assert.equal(state.qualifyingUnits, 11);
      await refresh();
      await expect(page.getByText('Verification pending', { exact: true })).toBeVisible();
      await expect(balance.getByRole('definition')).toHaveText(['0 coins', 'Unconfirmed']);
    },
  );
  await check(
    'real mission rewards stay unspendable until actual journal acknowledgement',
    async () => {
      const fault = {
        ...d.journal,
        append: async (record) => {
          await d.journal.append(record);
          throw Error('Injected lost mission acknowledgement');
        },
      };
      await assert.rejects(d.worker(fault).tick(), /Injected lost mission acknowledgement/);
      const state = await d.inspect();
      assert.equal(state.ledger, 2);
      assert.equal(state.seals, 0);
      assert.equal(state.account.progress, 11);
      assert.deepEqual(
        state.account.claims.map((c) => c.mission).sort(),
        ['collection.first_success', 'suggestions.10'].sort(),
      );
      await refresh();
      await expect(balance.getByRole('definition')).toHaveText(['30 coins', 'Unconfirmed']);
      await expect(page.getByText(/11 of 1,000 qualifying suggestions recorded/)).toBeVisible();
      await expect(page.getByText('Completed', { exact: true })).toHaveCount(2);
      await d.journal.restart();
      assert.equal((await d.worker().tick()).sealed, 1);
      assert.equal((await d.worker().tick()).sealed, 0);
      await refresh();
      await expect(balance.getByRole('definition')).toHaveText(['30 coins', '30 coins']);
    },
  );
  await check('actual ledger pages, reload and permanent session reads agree', async () => {
    const table = page.getByRole('table');
    await expect(table.getByRole('row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Load more history', exact: true }).click();
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(table.getByText('+20', { exact: true })).toBeVisible();
    await expect(table.getByText('+10', { exact: true })).toBeVisible();
    await page.reload();
    await expect(balance.getByRole('definition')).toHaveText(['30 coins', '30 coins']);
    await expect(table.getByRole('row')).toHaveCount(2);
    assert.equal((await d.inspect()).ledger, 2);
  });
  await check(
    'real expiring cursor fails safely and explicitly reloads the first page',
    async () => {
      const start = performance.now();
      const mobileContext = await browser.newContext({
        ...devices['Pixel 7'],
        reducedMotion: 'reduce',
      });
      await mobileContext.addCookies([cookie(actor.secret)]);
      const mobile = await mobileContext.newPage();
      await mobile.goto(origin + '/coins');
      await expect(mobile.getByText('Up to date', { exact: true })).toBeVisible();
      assert.equal(
        await mobile.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
        ),
        true,
      );
      const axe = await new AxeBuilder({ page: mobile }).analyze();
      assert.deepEqual(
        axe.violations.map((v) => v.id),
        [],
      );
      await mobile.screenshot({
        path: join(evidence, 'coins-synthetic-mobile.png'),
        fullPage: true,
      });
      await mobileContext.close();
      await page.screenshot({
        path: join(evidence, 'coins-synthetic-desktop.png'),
        fullPage: true,
      });
      const delay = Math.max(0, 31_000 - (performance.now() - start));
      if (delay) await new Promise((done) => setTimeout(done, delay));
      await page.getByRole('button', { name: 'Load more history', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('history link has expired or changed');
      await expect(page.getByRole('table')).toHaveCount(0);
      await page.getByRole('button', { name: 'Reload history', exact: true }).click();
      await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
      await expect(page.getByRole('alert')).toHaveCount(0);
    },
  );
  await check('real unavailable reads hide amounts and recover deliberately', async () => {
    await fixture.unavailable(true);
    await refresh();
    await expect(page.getByRole('alert')).toHaveCount(3);
    await expect(balance.getByRole('definition')).toHaveCount(0);
    await fixture.unavailable(false);
    await refresh();
    await expect(balance.getByRole('definition')).toHaveText(['30 coins', '30 coins']);
  });
  await check('fresh creator isolation and actual session expiry remove private work', async () => {
    const other = await api.seedSession({ expiresInMs: 5000 });
    const isolated = await browser.newContext();
    await isolated.addCookies([cookie(other.secret)]);
    const peer = await isolated.newPage();
    await peer.goto(origin + '/coins');
    await expect(
      peer.getByRole('region', { name: 'Your balance' }).getByRole('definition'),
    ).toHaveText(['0 coins', '0 coins']);
    await expect(peer.getByRole('heading', { name: 'No coin activity yet' })).toBeVisible();
    await expect(peer.getByRole('heading', { name: 'Your balance' })).toHaveCount(0, {
      timeout: 10000,
    });
    await isolated.close();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your balance' })).toHaveCount(0);
    await expect.poll(() => api.revoked(actor.sessionId)).toBe(true);
    assert.deepEqual(mutations, []);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => localStorage.length), 0);
  });
  assert.deepEqual(fingerprint(), sourceInputs);
  result = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    backendPin: api.source,
    sourceInputs,
    checks,
    syntheticProvidersAndModels: true,
    canonicalCollectionEarningVerified: true,
    liveProviderEarningVerified: false,
    qualifyingUnits: 11,
    rawMessages: 12,
    recordedReward: '30',
    ledgerRows: 2,
    journalRecords: 1,
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
  console.error('F09-03 failed during ' + phase + ': ' + detail);
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
      ' actual creator-coins browser/API/SQL/journal scenarios; owned runtime cleaned.',
  );
}
