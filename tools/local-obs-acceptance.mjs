import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer, build } from 'vite';
import jsQR from 'jsqr';
import { startLocalApi } from './local-api.mjs';
import { observationPage } from './obs-observation-page.mjs';
import { createMobileQrRelay, openAcceptanceTunnel } from './mobile-qr-relay.mjs';

const phoneTest = process.argv.includes('--phone');
if (phoneTest && !process.argv.includes('--observe'))
  throw new Error('Phone QR requires explicit bounded observation.');
const origin = 'http://127.0.0.1:4175',
  directory = phoneTest ? 'artifacts.local/f07-mobile' : 'artifacts.local/f07',
  checks = [],
  errors = [];
let api,
  vite,
  browser,
  stage = 'startup',
  handoff = null,
  mobile,
  relay;
mkdirSync(directory, { recursive: true });
const frontendSource = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
  files: Object.fromEntries(
    [
      'src/app/overlay-main.tsx',
      'src/services/overlay/reader.ts',
      'src/services/overlay/owner.ts',
      'src/services/overlay/qr.ts',
      'src/services/overlay/clipboard.ts',
      'tools/obs-observation-page.mjs',
      'tools/mobile-qr-relay.mjs',
      'src/features/overlay-display/display.tsx',
      'src/features/overlay-display/display.css',
      'src/features/overlay-settings/settings.tsx',
      'src/routes/overlay-settings.tsx',
      'tools/local-obs-acceptance.mjs',
      'tools/local-api.mjs',
      'vite.config.ts',
      'package-lock.json',
      'vendor/contracts/provenance.json',
    ].map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
  ),
};
try {
  if (phoneTest) {
    stage = 'prepare scoped mobile HTTPS surface';
    relay = createMobileQrRelay({ directory: resolve(directory, 'dist') });
    mobile = await openAcceptanceTunnel(relay);
    stage = 'build public mobile contribution entry';
    process.env.VITE_APP_ENV = 'local';
    process.env.VITE_PUBLIC_API_ORIGIN = mobile.origin;
    await build({
      mode: 'acceptance-qr-mobile',
      envDir: false,
      clearScreen: false,
      build: { outDir: resolve(directory, 'dist'), emptyOutDir: false },
    });
  }
  api = await startLocalApi({
    backend: process.argv[2] ?? '../tmp/backend-f06-readiness',
    origins: [origin],
    task: 'f07',
    overlay: true,
    collection: true,
    review: true,
    terms: true,
    ...(mobile ? { qrPublicOrigin: mobile.origin } : {}),
  });
  if (phoneTest) copyFileSync('artifacts.local/f07/runtime.json', directory + '/runtime.json');
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  vite = await createServer({
    mode: 'acceptance-obs',
    envDir: false,
    clearScreen: false,
    server: { host: '127.0.0.1', port: 4175, strictPort: true, hmr: false },
    plugins: [
      {
        name: 'bounded-f07-human-observation',
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (request.url !== '/__f07_observation') return next();
            if (
              request.method !== 'GET' ||
              request.headers.host !== '127.0.0.1:4175' ||
              (request.headers.origin && request.headers.origin !== origin) ||
              request.headers['sec-fetch-site'] === 'cross-site'
            ) {
              response.writeHead(403).end();
              return;
            }
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('Referrer-Policy', 'no-referrer');
            response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
            const nonce = randomBytes(18).toString('base64url');
            response.setHeader(
              'Content-Security-Policy',
              `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
            );
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(observationPage(handoff, nonce));
          });
        },
      },
    ],
  });
  await vite.listen();
  browser = await chromium.launch();
  const creator = await api.seedSession({ expiresInMs: 2400000 }),
    owner = await browser.newContext();
  await owner.addCookies([
    {
      name: 'darve_session',
      value: creator.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const session = await (
    await owner.request.get(api.apiOrigin + '/api/session', { headers: { Origin: origin } })
  ).json();
  const headers = { Origin: origin, 'X-CSRF-Token': session.csrfToken };
  const get = async (path) => {
    const response = await owner.request.get(api.apiOrigin + path, { headers });
    assert.equal(response.status(), 200);
    return (await response.json()).data;
  };
  const policy = await get('/api/terms/current');
  assert.equal(
    (
      await owner.request.post(api.apiOrigin + '/api/terms/acceptance', {
        headers,
        data: {
          documentId: policy.documentId,
          version: policy.version,
          contentHash: policy.contentHash,
          accepted: true,
        },
      })
    ).status(),
    200,
  );
  api.collectionFixture.capacity('available');
  async function accepted() {
    const stream = await api.collectionFixture.seed(creator.userId);
    const start = await owner.request.post(api.apiOrigin + '/api/rounds', {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: {
        connectionId: stream.connectionId,
        broadcastId: stream.broadcastId,
        collectionDurationSeconds: 60,
        announcementPinMode: 'off',
      },
    });
    assert.equal(start.status(), 202);
    const roundId = (await start.json()).data.id;
    await api.collectionFixture.recover();
    const active = await get('/api/rounds/' + roundId);
    await api.collectionFixture.admitIdeas(creator.userId, roundId);
    assert.equal(
      (
        await owner.request.post(`${api.apiOrigin}/api/rounds/${roundId}/collection/stop`, {
          headers,
          data: { expectedVersion: active.version },
        })
      ).status(),
      202,
    );
    await api.reviewFixture.publish(creator.userId, roundId);
    const suggestions = await get(`/api/rounds/${roundId}/suggestions`),
      item = suggestions.items[0];
    const result = await owner.request.post(
      `${api.apiOrigin}/api/rounds/${roundId}/suggestions/${item.id}/accept`,
      {
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {
          expectedVersion: item.version,
          analysisRunId: item.analysisRunId,
          resultVersion: suggestions.resultVersion,
          snapshotVersion: item.snapshotVersion,
          goal: { amountMinor: '100000', currency: 'EUR' },
          fundingDurationSeconds: 1800,
        },
      },
    );
    assert.equal(result.status(), 201);
    return { id: (await result.json()).data.id, roundId };
  }
  stage = 'create accepted challenge for owner controls';
  const challenge = await accepted(),
    detail = await get('/api/challenges/' + challenge.id);
  stage = 'load actual OBS owner controls';
  const creatorPage = await owner.newPage();
  creatorPage.on('pageerror', (error) => errors.push(error.name));
  await creatorPage.goto(origin + '/obs', { waitUntil: 'domcontentloaded' });
  await expect(
    creatorPage.getByRole('heading', { name: 'OBS display', exact: true }),
  ).toBeVisible();
  await expect(creatorPage.getByRole('button', { name: 'Create private OBS link' })).toBeDisabled();
  stage = 'issue reviewed private OBS link';
  await creatorPage.getByRole('checkbox', { name: /I understand this read-only link/ }).check();
  await creatorPage.getByRole('button', { name: 'Create private OBS link' }).click();
  const privateInput = creatorPage.getByLabel('Private browser-source URL');
  await expect(privateInput).toHaveValue(/#grant=/);
  const presentationUrl = await privateInput.inputValue(),
    displayId = new URL(presentationUrl).pathname.split('/').at(-1);
  const grantId = await creatorPage.getByLabel('Known grant ID to revoke').inputValue();
  checks.push(
    'actual creator session/terms/CSRF issues one original private link only after explicit review',
  );
  stage = 'select accepted challenge for actual OBS display';
  await creatorPage.getByRole('button', { name: 'Review for display' }).first().click();
  await creatorPage.getByRole('checkbox', { name: /Show this selection/ }).check();
  await creatorPage.getByRole('button', { name: 'Confirm display selection' }).click();
  await expect(
    creatorPage.getByRole('status').filter({ hasText: 'Display selection confirmed' }),
  ).toBeVisible();
  const binding = await get('/api/overlay-displays/' + displayId);
  assert.equal(binding.challengeId, challenge.id);
  assert.equal(binding.roundId, challenge.roundId);
  checks.push(
    'actual explicit owner selection binds exact accepted round/challenge without changing immutable challenge or money',
  );
  if (!process.argv.includes('--observe')) {
    stage = 'read actual display from dashboard';
    const href = await creatorPage
      .getByRole('link', { name: 'View this display on the dashboard' })
      .getAttribute('href');
    assert.equal(href, '/dashboard?displayId=' + displayId);
    const dashboard = await owner.newPage();
    const writes = [];
    dashboard.on('request', (request) => {
      if (
        new URL(request.url()).origin === api.apiOrigin &&
        !['GET', 'OPTIONS'].includes(request.method())
      )
        writes.push(request.method());
    });
    await dashboard.goto(origin + href);
    const summary = dashboard.getByRole('region', { name: 'OBS display' });
    await expect(summary.getByRole('link', { name: 'Open displayed challenge' })).toHaveAttribute(
      'href',
      '/challenges/' + challenge.id,
    );
    await expect(summary.getByText(/Template:/)).toBeVisible();
    await expect(summary.getByRole('link', { name: 'Open OBS setup' })).toHaveAttribute(
      'href',
      '/obs?displayId=' + displayId,
    );
    assert.deepEqual(await get('/api/overlay-displays/' + displayId), binding);
    assert.deepEqual(writes, []);
    await dashboard.close();
    checks.push(
      'actual dashboard reads the explicitly opened OBS selection and preferences without changing the binding or issuing a grant',
    );
  }
  stage = 'isolated reader bootstrap';
  const reader = await browser.newContext({ viewport: { width: 1920, height: 1080 } }),
    page = await reader.newPage();
  page.on('pageerror', (error) => errors.push(error.name));
  let bootstrap = 0,
    streams = 0,
    ownerReads = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== api.apiOrigin) return;
    if (url.pathname === '/api/session') ownerReads++;
    if (url.pathname.endsWith('/session')) bootstrap++;
    if (url.pathname.endsWith('/events')) streams++;
  });
  await page.goto(presentationUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.obs-card')).toBeVisible();
  assert.equal(bootstrap, 1);
  assert.equal(ownerReads, 0);
  assert.ok(page.url().endsWith('#grantId=' + grantId));
  assert.ok(!page.url().includes('#grant='));
  assert.equal(
    await page.evaluate(
      () => globalThis.getComputedStyle(globalThis.document.body).backgroundColor,
    ),
    'rgba(0, 0, 0, 0)',
  );
  checks.push(
    'actual production presentation entry bootstraps separate HttpOnly reader cookie, sanitizes access fragment and loads no creator authority',
  );
  for (const size of [150, 100]) {
    const pixels = await page
      .getByRole('img', { name: 'Scan to view this challenge' })
      .evaluate(async (node, size) => {
        const image = new globalThis.Image();
        image.src =
          'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(new globalThis.XMLSerializer().serializeToString(node));
        await image.decode();
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, 0, 0, size, size);
        return Array.from(ctx.getImageData(0, 0, size, size).data);
      }, size);
    assert.equal(jsQR(new Uint8ClampedArray(pixels), size, size)?.data, detail.contributionUrl);
  }
  checks.push(
    'actual selected challenge QR rendered pixels independently decode to the exact public URL at 1080p/720p scale',
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.obs-card')).toBeVisible();
  assert.equal(bootstrap, 1);
  checks.push(
    'same-browser sanitized reader reload recovers through its existing matching cookie without reissuing/bootstrap',
  );
  const foreign = await browser.newContext(),
    foreignPage = await foreign.newPage();
  await foreignPage.goto(page.url(), { waitUntil: 'domcontentloaded' });
  await expect(foreignPage.locator('[data-obs-phase="denied"]')).toHaveCount(1);
  await expect(foreignPage.locator('.obs-card')).toHaveCount(0);
  await foreign.close();
  checks.push('copied sanitized grantId URL in a foreign browser has no authority or content');
  stage = 'selection and preference stream changes';
  await creatorPage.getByLabel('Opacity', { exact: true }).fill('0.75');
  await creatorPage.getByRole('checkbox', { name: /Apply these settings/ }).check();
  await creatorPage.getByRole('button', { name: 'Save display settings' }).click();
  await expect(page.locator('.obs-card')).toHaveCSS('opacity', '0.75');
  checks.push('actual versioned owner preference update reaches the active reader through SSE');
  const current = await get('/api/overlay-displays/' + displayId);
  const stale = await owner.request.put(
    `${api.apiOrigin}/api/overlay-displays/${displayId}/selection`,
    { headers, data: { expectedVersion: current.version - 1, roundId: null, challengeId: null } },
  );
  assert.equal(stale.status(), 409);
  checks.push('actual stale display revision is rejected without moving selection');
  api.interruptConnections();
  await expect(page.locator('.obs-card')).toHaveCount(0);
  await expect(page.locator('.obs-card')).toBeVisible({ timeout: 15000 });
  assert.equal(bootstrap, 1);
  assert.ok(streams >= 2);
  checks.push(
    'actual socket interruption clears presentation and reauthorizes the same reader on reconnect without bootstrap',
  );
  await creatorPage.getByRole('button', { name: 'Show idle display' }).click();
  await creatorPage.getByRole('checkbox', { name: /Show this selection/ }).check();
  await creatorPage.getByRole('button', { name: 'Confirm display selection' }).click();
  await expect(page.locator('.obs-card')).toHaveCount(0);
  checks.push('explicit owner idle selection removes challenge and QR from the active reader');
  await creatorPage.getByRole('button', { name: 'Review for display' }).first().click();
  await creatorPage.getByRole('checkbox', { name: /Show this selection/ }).check();
  await creatorPage.getByRole('button', { name: 'Confirm display selection' }).click();
  await expect(page.locator('.obs-card')).toBeVisible();
  await api.reviewFixture.restrict(challenge.roundId);
  await expect(page.locator('.obs-card')).toHaveCount(0);
  checks.push(
    'persisted source restriction removes selected wording, attribution and QR from actual stream',
  );
  await creatorPage.getByRole('checkbox', { name: /Revoke this link/ }).check();
  await creatorPage.getByRole('button', { name: 'Revoke OBS link' }).click();
  await expect(page.locator('[data-obs-phase="denied"]')).toHaveCount(1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-obs-phase="denied"]')).toHaveCount(1);
  checks.push('actual owner revocation ends active access and prevents sanitized reload');
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  assert.deepEqual(errors, []);
  const record = {
    task: 'F07',
    frontendSource,
    runId: api.runId,
    backendSource: api.source,
    migrations: api.migrations,
    checks,
    pageErrors: errors,
    actualPostgresRedis: true,
    actualApiAndReaderCookie: true,
    syntheticProviderModelAndSource: true,
    externalCalls: phoneTest,
    externalProviderCalls: false,
    temporaryPublicHttps: phoneTest,
    livePayments: false,
    obsObserved: false,
    physicalQrObserved: false,
  };
  writeFileSync(directory + '/acceptance.json', JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
  if (process.argv.includes('--observe')) {
    stage = 'human OBS observation';
    const observedChallenge = await accepted(),
      observedDetail = await get('/api/challenges/' + observedChallenge.id);
    const issued = await owner.request.post(api.apiOrigin + '/api/overlay-grants', {
      headers,
      data: {},
    });
    assert.equal(issued.status(), 201);
    const grant = (await issued.json()).data;
    const selection = await get('/api/overlay-displays/' + grant.displayId);
    assert.equal(
      (
        await owner.request.put(
          `${api.apiOrigin}/api/overlay-displays/${grant.displayId}/selection`,
          {
            headers,
            data: {
              expectedVersion: selection.version,
              roundId: observedChallenge.roundId,
              challengeId: observedChallenge.id,
            },
          },
        )
      ).status(),
      200,
    );
    const preferences = await get('/api/overlay-preferences?protocolVersion=2');
    assert.equal(
      (
        await owner.request.patch(api.apiOrigin + '/api/overlay-preferences?protocolVersion=2', {
          headers,
          data: {
            expectedVersion: preferences.version,
            styles: { ...preferences.styles, opacity: 1, scale: 0.75 },
          },
        })
      ).status(),
      200,
    );
    const deadline = Date.now() + 1800000;
    if (mobile) {
      stage = 'verify real public mobile contribution';
      relay.bind({
        origin: mobile.origin,
        publicId: observedDetail.publicId,
        apiOrigin: api.apiOrigin,
        deadline,
      });
      const publicPage = await fetch(observedDetail.contributionUrl, {
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(publicPage.status, 200);
      await publicPage.body?.cancel();
      const publicRead = await fetch(
        mobile.origin + '/api/public/challenges/' + observedDetail.publicId,
        { redirect: 'error', signal: AbortSignal.timeout(15000) },
      );
      assert.equal(publicRead.status, 200);
      const publicData = (await publicRead.json()).data;
      assert.equal(publicData.publicId, observedDetail.publicId);
      assert.equal(publicData.checkoutAvailability.available, false);
      const blocked = [];
      for (const path of [
        '/api/session',
        '/api/overlay-grants',
        '/__f07_observation',
        '/overlay/' + grant.displayId,
        '/api/checkouts/' + grant.id,
        '/api/public/challenges/' + grant.id,
      ]) {
        const response = await fetch(mobile.origin + path, {
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
        });
        assert.equal(response.status, 404);
        await response.body?.cancel();
        blocked.push(path.split('/').slice(0, 3).join('/'));
      }
      const mutation = await fetch(
        mobile.origin + '/api/public/challenges/' + observedDetail.publicId,
        { method: 'POST', body: '{}', signal: AbortSignal.timeout(15000) },
      );
      assert.equal(mutation.status, 405);
      await mutation.body?.cancel();
      const phoneContext = await browser.newContext({
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
        }),
        phone = await phoneContext.newPage();
      phone.on('pageerror', (error) => errors.push(error.name));
      await phone.goto(observedDetail.contributionUrl, { waitUntil: 'domcontentloaded' });
      await expect(phone.getByText(observedDetail.terms.text, { exact: true })).toBeVisible({
        timeout: 15000,
      });
      assert.deepEqual(errors, []);
      await phoneContext.close();
      record.mobileHttps = {
        origin: mobile.origin,
        publicId: observedDetail.publicId,
        contributionPageHttp: 200,
        publicApiHttp: 200,
        productionMobileBrowserPassed: true,
        blockedPrivateRoutes: blocked.length,
        mutationsDenied: true,
        creationEnabled: false,
        toolVersion: mobile.toolVersion,
        checksumVerified: mobile.checksumVerified,
      };
      stage = 'human phone QR observation';
    }
    handoff = {
      presentationUrl: grant.presentationUrl,
      publicUrl: observedDetail.contributionUrl,
      phoneReachable: phoneTest,
    };
    for (const denied of [false, true]) {
      const setupContext = await browser.newContext();
      await setupContext.addInitScript(
        ({ denied }) =>
          Object.defineProperty(globalThis.navigator, 'clipboard', {
            value: {
              writeText: async (value) => {
                if (denied) throw new Error('Controlled clipboard denial');
                globalThis.f07Copied = value;
              },
            },
          }),
        { denied },
      );
      const setupPage = await setupContext.newPage();
      await setupPage.goto(origin + '/__f07_observation', { waitUntil: 'domcontentloaded' });
      await setupPage.getByRole('button', { name: 'Copy private OBS link', exact: true }).click();
      if (denied) {
        await expect(
          setupPage.getByRole('status').filter({ hasText: 'Clipboard access is unavailable' }),
        ).toBeVisible();
        await expect(setupPage.getByLabel('Private OBS access link')).toHaveAttribute(
          'type',
          'text',
        );
      } else {
        await expect(
          setupPage.getByRole('status').filter({ hasText: 'Private OBS link copied' }),
        ).toBeVisible();
        assert.equal(
          await setupPage.evaluate(
            (value) => globalThis.f07Copied === value,
            grant.presentationUrl,
          ),
          true,
        );
      }
      await setupContext.close();
    }
    record.handoffCopyChecks = [
      'nonce-protected loopback handoff copies the exact original private source link on explicit click',
      'clipboard denial reveals and selects the private link for manual copy without issuing a replacement',
    ];
    writeFileSync(directory + '/acceptance.json', JSON.stringify(record, null, 2));
    writeFileSync(
      directory + '/observation-status.json',
      JSON.stringify(
        {
          task: 'F07',
          runId: api.runId,
          stage: 'awaiting-human-observation',
          frontendSource,
          setupUrl: origin + '/__f07_observation',
          publicUrl: observedDetail.contributionUrl,
          deadline: new Date(deadline).toISOString(),
          noPrivateUrlInArtifacts: true,
          phoneReachable: phoneTest,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        stage,
        setupUrl: origin + '/__f07_observation',
        deadline: new Date(deadline).toISOString(),
      }),
    );
    let reported = false;
    while (Date.now() < deadline) {
      if (existsSync(directory + '/control.json')) {
        const command = JSON.parse(readFileSync(directory + '/control.json', 'utf8'));
        if (command.runId === api.runId && ['finish', 'stop'].includes(command.action)) {
          writeFileSync(
            directory + '/observation-status.json',
            JSON.stringify(
              {
                task: 'F07',
                runId: api.runId,
                stage: command.action === 'finish' ? 'human-reported-complete' : 'stopped',
                observations: command.observations ?? null,
                ...(relay ? { relay: relay.audit() } : {}),
              },
              null,
              2,
            ),
          );
          reported = true;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!reported)
      writeFileSync(
        directory + '/observation-status.json',
        JSON.stringify(
          {
            task: 'F07',
            runId: api.runId,
            stage: 'expired-without-human-confirmation',
            frontendSource,
          },
          null,
          2,
        ),
      );
    handoff = null;
    await owner.request.delete(api.apiOrigin + '/api/overlay-grants/' + grant.id, { headers });
  }
} catch (error) {
  console.error(
    JSON.stringify({
      stage,
      error: error.name,
      ...(error.mobileQrDiagnostic ? { mobileQrDiagnostic: error.mobileQrDiagnostic } : {}),
      message: error instanceof assert.AssertionError ? error.message : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  handoff = null;
  try {
    await browser?.close();
    await vite?.close();
    await api?.close();
  } finally {
    await mobile?.close();
  }
}
