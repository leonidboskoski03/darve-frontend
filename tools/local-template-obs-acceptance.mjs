import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build, preview } from 'vite';
import { chromium, expect } from '@playwright/test';
import jsQR from 'jsqr';
import { startLocalApi } from './local-api.mjs';
import { verifyTemplateAsset } from './template-assets.mjs';
import { observationPage } from './obs-observation-page.mjs';
const observe = process.argv.includes('--observe');
let handoff = null,
  observed = false;
const directory = resolve('artifacts.local/f09-05'),
  origin = 'http://127.0.0.1:4175';
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
          ((/^src\//.test(file) && !/(\.test|\.test-helper)\./.test(file)) ||
            /^(assets\/overlay-templates\/|tools\/|package(?:-lock)?\.json|vite\.config\.ts)/.test(
              file,
            )),
      )
      .sort()
      .map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
  );
const sourceInputs = fingerprint(),
  checks = [];
let api,
  site,
  browser,
  phase = 'setup',
  result;
async function check(name, fn) {
  phase = name;
  await fn();
  checks.push(name);
  console.log('PASS ' + name);
}
try {
  const manifest = verifyTemplateAsset();
  api = await startLocalApi({
    backend: process.argv[2] ?? '../tmp/backend-f06-checkout',
    task: 'f09-05',
    coins: true,
    overlay: true,
    collection: true,
    review: true,
    terms: true,
    origins: [origin],
    port: 3310,
  });
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  const outDir = join(directory, 'public-build');
  await build({
    configFile: 'vite.config.ts',
    envDir: false,
    mode: 'template-obs-acceptance',
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  site = await preview({
    plugins: [
      {
        name: 'bounded-f09-05-observation',
        configurePreviewServer(server) {
          server.middlewares.use((request, response, next) => {
            if (request.url !== '/__f09_observation') return next();
            if (
              request.method !== 'GET' ||
              request.headers.host !== '127.0.0.1:4175' ||
              request.headers['sec-fetch-site'] === 'cross-site'
            ) {
              response.writeHead(403).end();
              return;
            }
            const nonce = randomBytes(18).toString('base64url');
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('Referrer-Policy', 'no-referrer');
            response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
            response.setHeader(
              'Content-Security-Policy',
              `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
            );
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(observationPage(handoff, nonce).replaceAll('F07', 'F09-05'));
          });
        },
      },
    ],
    configFile: 'vite.config.ts',
    envDir: false,
    mode: 'template-obs-acceptance',
    logLevel: 'silent',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  });
  browser = await chromium.launch();
  const creator = await api.seedSession({
      coinOwner: true,
      expiresInMs: observe ? 1800000 : 600000,
    }),
    owner = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await owner.addCookies([
    {
      name: 'darve_session',
      value: creator.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const identity = await (await owner.request.get(api.apiOrigin + '/api/session')).json(),
    headers = { Origin: origin, 'X-CSRF-Token': identity.csrfToken };
  const get = async (path) => {
    const response = await owner.request.get(api.apiOrigin + path, { headers });
    assert.equal(response.status(), 200, path);
    return (await response.json()).data;
  };
  const post = async (path, data) => owner.request.post(api.apiOrigin + path, { headers, data });
  const fixture = api.coinFixture,
    d = fixture.durability,
    t = fixture.templates;
  assert(d && t);
  await fixture.configure();
  await t.installManifest(manifest);
  await t.price(manifest.id, '10', 0);
  const challenge = await api.prepareTemplateOverlay(creator.secret);
  await d.worker().tick();
  const page = await owner.newPage();
  let grant, display, displayContext, selectionBefore, layoutBefore, balanceBefore;
  const refresh = async () => {
    await page.getByRole('button', { name: 'Refresh ownership', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Refresh ownership', exact: true }),
    ).toBeEnabled();
  };
  const pick = async (name) => {
    await page.getByRole('button', { name: 'Select ' + name, exact: true }).click();
    await page
      .getByRole('checkbox', { name: 'I want to use this owned template for my OBS displays.' })
      .check();
    await page.getByRole('button', { name: 'Use this template', exact: true }).click();
  };
  await check(
    'actual canonical earning and exact redemption verify ownership before selection',
    async () => {
      await page.goto(origin + '/templates');
      await page.getByRole('button', { name: 'Review Darve Compact', exact: true }).click();
      await page.getByRole('checkbox', { name: /I reviewed the/ }).check();
      await page.getByRole('button', { name: 'Confirm redemption', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Ownership verification pending' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Select Darve Compact', exact: true }),
      ).toHaveCount(0);
      await d.worker().tick();
      await refresh();
      await expect(
        page.getByRole('button', { name: 'Select Darve Compact', exact: true }),
      ).toBeEnabled();
    },
  );
  await check(
    'real protocol-2 private display starts with existing standalone renderer',
    async () => {
      const response = await post('/api/overlay-grants', {});
      assert.equal(response.status(), 201);
      grant = (await response.json()).data;
      const selected = await owner.request.put(
        api.apiOrigin + '/api/overlay-displays/' + grant.displayId + '/selection',
        {
          headers,
          data: {
            expectedVersion: grant.selection.version,
            roundId: challenge.roundId,
            challengeId: challenge.challengeId,
          },
        },
      );
      if (selected.status() !== 200)
        await api.diagnoseTemplateBinding(creator.secret, grant.displayId, {
          expectedVersion: grant.selection.version,
          roundId: challenge.roundId,
          challengeId: challenge.challengeId,
        });
      assert.equal(selected.status(), 200);
      displayContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      display = await displayContext.newPage();
      await display.goto(grant.presentationUrl);
      await expect(display.locator('.obs-stage')).toHaveAttribute('data-template', 'standalone');
      await expect(display.locator('.obs-card')).toBeVisible();
      selectionBefore = await get('/api/overlay-displays/' + grant.displayId);
      layoutBefore = await get('/api/overlay-preferences?protocolVersion=2');
      balanceBefore = await get('/api/coins/account');
    },
  );
  await check(
    'reviewed selection reaches actual SSE without changing layout, challenge or coins',
    async () => {
      await pick('Darve Compact');
      await expect(page.getByText('Template selection verified.', { exact: true })).toBeVisible();
      await expect(display.locator('.obs-stage')).toHaveAttribute('data-template', 'compact');
      await expect(display.locator('.obs-card')).toHaveCSS('width', '840px');
      const current = await get('/api/overlay-displays/' + grant.displayId),
        layout = await get('/api/overlay-preferences?protocolVersion=2');
      assert.equal(current.roundId, selectionBefore.roundId);
      assert.equal(current.challengeId, selectionBefore.challengeId);
      assert.equal(current.version, selectionBefore.version);
      assert.equal(layout.version, layoutBefore.version);
      assert.deepEqual(layout.styles, layoutBefore.styles);
      assert.deepEqual(await get('/api/coins/account'), balanceBefore);
      await display
        .locator('.obs-card')
        .screenshot({ path: join(directory, 'compact-actual-1080.png'), omitBackground: true });
    },
  );
  await check(
    'actual compact QR independently decodes the canonical public destination at 1080p and 720p scale',
    async () => {
      const payload = await display
        .getByRole('img', { name: 'Scan to view this challenge' })
        .evaluate((node) => new globalThis.XMLSerializer().serializeToString(node));
      const expected = challenge.publicUrl;
      for (const size of [150, 100]) {
        const pixels = await display.evaluate(
          async ({ svg, size }) => {
            const image = new globalThis.Image();
            image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
            await image.decode();
            const canvas = globalThis.document.createElement('canvas');
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(image, 0, 0, size, size);
            return Array.from(ctx.getImageData(0, 0, size, size).data);
          },
          { svg: payload, size },
        );
        const url = jsQR(new Uint8ClampedArray(pixels), size, size)?.data;
        assert.equal(url, expected);
      }
      assert.equal(
        await display.evaluate(
          () => globalThis.getComputedStyle(globalThis.document.body).backgroundColor,
        ),
        'rgba(0, 0, 0, 0)',
      );
    },
  );
  await check(
    'fresh reader bootstraps after compact selection and reloads with its own cookie',
    async () => {
      const fresh = await browser.newContext({ viewport: { width: 1920, height: 1080 } }),
        source = await fresh.newPage();
      await source.goto(grant.presentationUrl);
      await expect(source.locator('.obs-stage')).toHaveAttribute('data-template', 'compact');
      await source.reload();
      await expect(source.locator('.obs-stage')).toHaveAttribute('data-template', 'compact');
      await fresh.close();
    },
  );
  if (observe) {
    const ack = join(directory, 'obs-observation.json');
    if (existsSync(ack)) unlinkSync(ack);
    handoff = {
      presentationUrl: grant.presentationUrl,
      publicUrl: challenge.publicUrl,
      phoneReachable: false,
    };
    console.log(
      'READY: bounded F09-05 OBS observation at ' + origin + '/__f09_observation (15 minutes).',
    );
    const until = Date.now() + 15 * 60000;
    while (!existsSync(ack) && Date.now() < until)
      await new Promise((done) => setTimeout(done, 1000));
    assert(existsSync(ack), 'OBS observation window expired');
    const confirmation = JSON.parse(readFileSync(ack, 'utf8'));
    assert.equal(confirmation.cardAppears, true);
    assert.equal(confirmation.lifecycleReturns, true);
    observed = true;
    checks.push('founder observed actual OBS compact card and lifecycle return');
    handoff = null;
  }
  await check(
    'layout-only protocol-2 writes preserve template and legacy writes cannot reset it',
    async () => {
      const old = await get('/api/overlay-preferences?protocolVersion=2'),
        styles = { ...old.styles, position: 'top_right', scale: 2 / 3, marginX: 24, marginY: 24 };
      const saved = await owner.request.patch(
        api.apiOrigin + '/api/overlay-preferences?protocolVersion=2',
        { headers, data: { expectedVersion: old.version, styles } },
      );
      assert.equal(saved.status(), 200);
      assert.equal((await saved.json()).data.template.templateId, manifest.id);
      await display.setViewportSize({ width: 1280, height: 720 });
      await expect(display.locator('.obs-stage')).toHaveAttribute('data-position', 'top_right');
      await display
        .locator('.obs-card')
        .screenshot({ path: join(directory, 'compact-actual-720.png'), omitBackground: true });
      const legacy = await owner.request.patch(api.apiOrigin + '/api/overlay-preferences', {
        headers,
        data: { expectedVersion: old.version + 1, styles: { ...styles, themeStyle: 'standalone' } },
      });
      assert.equal(legacy.status(), 409);
      assert.equal((await legacy.json()).error.code, 'OVERLAY_COMPATIBILITY_REQUIRED');
    },
  );
  await check(
    'stale selection is re-read and a committed lost response is never replayed',
    async () => {
      await page.getByRole('button', { name: 'Select Standalone', exact: true }).click();
      await page
        .getByRole('checkbox', { name: 'I want to use this owned template for my OBS displays.' })
        .check();
      const before = await get('/api/template-preferences');
      assert.equal(
        (
          await post('/api/template-preferences', {
            expectedRevision: before.revision,
            templateId: 'standalone',
          })
        ).status(),
        200,
      );
      const stalePromise = page.waitForResponse(
        (r) => r.url().endsWith('/api/template-preferences') && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Use this template' }).click();
      assert.equal((await stalePromise).status(), 409);
      await expect(page.getByText('Template selection verified.', { exact: true })).toBeVisible();
      let count = 0;
      await page.route(api.apiOrigin + '/api/template-preferences', async (route) => {
        if (route.request().method() === 'POST') {
          count++;
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          await route.abort('failed');
        } else await route.continue();
      });
      await pick('Darve Compact');
      await expect(page.getByText('Template selection verified.', { exact: true })).toBeVisible();
      assert.equal(count, 1);
      await page.unroute(api.apiOrigin + '/api/template-preferences');
      await expect(display.locator('.obs-stage')).toHaveAttribute('data-template', 'compact');
    },
  );
  await check('cookie reload and withdrawal hide rather than render stale content', async () => {
    await display.reload();
    await expect(display.locator('.obs-stage')).toHaveAttribute('data-template', 'compact');
    await t.withdraw(manifest.id, 1);
    await expect(display.locator('.obs-card')).toHaveCount(0);
    await page.getByRole('button', { name: 'Refresh selected template' }).click();
    await expect(page.getByText(/selected template is unavailable or unsupported/)).toBeVisible();
    await pick('Standalone');
    await expect(display.locator('.obs-stage')).toHaveAttribute('data-template', 'standalone');
  });
  await check(
    'unsupported future asset version stays owned and cannot be offered as usable',
    async () => {
      await t.installManifest({
        ...manifest,
        version: 2,
        assetHash: 'a'.repeat(64),
        approvalHash: 'b'.repeat(64),
      });
      await refresh();
      await expect(
        page.getByRole('button', { name: 'Select Darve Compact', exact: true }),
      ).toHaveCount(0);
      const current = await get('/api/template-preferences');
      assert.equal(
        (
          await post('/api/template-preferences', {
            expectedRevision: current.revision,
            templateId: manifest.id,
          })
        ).status(),
        200,
      );
      await expect(display.locator('.obs-card')).toHaveCount(0);
      const entitlements = await get('/api/template-entitlements');
      assert(
        entitlements.templates.some(
          (row) =>
            row.id === manifest.id && row.ownershipState === 'owned' && row.assetVersion === 2,
        ),
      );
    },
  );
  await check(
    'revoked reader access and logout remove private presentation and selection controls',
    async () => {
      assert.equal(
        (
          await owner.request.delete(api.apiOrigin + '/api/overlay-grants/' + grant.id, {
            headers,
          })
        ).status(),
        204,
      );
      await display.reload();
      await expect(display.locator('.obs-card')).toHaveCount(0);
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect.poll(() => api.revoked(creator.sessionId)).toBe(true);
      await expect(page.getByRole('heading', { name: 'OBS template', exact: true })).toHaveCount(0);
    },
  );
  assert.deepEqual(fingerprint(), sourceInputs);
  result = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    backend: api.source,
    sourceInputs,
    checks,
    manifest,
    syntheticProvidersModelsPrice: true,
    actualOBSApplication: observed,
    actualAPIAndSSE: true,
    createdAt: new Date().toISOString(),
  };
} catch (error) {
  const detail = String(error.message)
    .replace(/(?:postgres(?:ql)?|redis):\/\/[^\s]+/g, '[private storage]')
    .replace(/#grant=[^\s]+/g, '[private grant]')
    .replace(/[A-Za-z0-9_+/=-]{32,}/g, '[redacted]');
  writeFileSync(
    join(directory, 'failure.json'),
    JSON.stringify(
      { phase, name: error.name, detail, location: error.stack?.split('\n').slice(1, 5), checks },
      null,
      2,
    ),
  );
  console.error('F09-05 failed during ' + phase + ': ' + detail);
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
    join(directory, 'acceptance.json'),
    JSON.stringify({ ...result, cleanupComplete: true }, null, 2),
  );
  console.log(
    'Passed ' +
      checks.length +
      ' actual template/OBS HTTP/SSE/journal scenarios; owned runtime cleaned.',
  );
}
