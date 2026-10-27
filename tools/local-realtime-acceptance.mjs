import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import { startLocalApi } from './local-api.mjs';

let api, vite, browser;
const origin = 'http://127.0.0.1:4175';
const checks = [],
  errors = [];
try {
  api = await startLocalApi({
    backend: process.argv[2] ?? '../darve-backend',
    origins: [origin],
    task: 'f02-03',
    overlay: true,
  });
  vite = await createServer({
    clearScreen: false,
    server: { host: '127.0.0.1', port: 4175, strictPort: true, hmr: false },
  });
  await vite.listen();
  browser = await chromium.launch();
  const owner = await api.seedSession({ expiresInMs: 180_000 });
  const ownerCookie = `darve_session=${owner.secret}`;
  const sessionResponse = await fetch(api.apiOrigin + '/api/session', {
    headers: { Cookie: ownerCookie },
  });
  const ownerSession = await sessionResponse.json();
  if (!ownerSession.authenticated) throw new Error('Local owner session unavailable.');
  const command = async (path, method, body) => {
    const response = await fetch(api.apiOrigin + path, {
      method,
      headers: {
        Cookie: ownerCookie,
        Origin: origin,
        'X-CSRF-Token': ownerSession.csrfToken,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Local overlay owner command failed: ${response.status}.`);
    return response.status === 204 ? null : response.json();
  };
  for (const protocol of [1, 2]) {
    const issued = await command('/api/overlay-grants', 'POST', {});
    const { id: grantId, displayId, presentationUrl } = issued.data;
    const secret = new URL(presentationUrl).hash.slice('#grant='.length);
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.name));
    let opens = 0,
      snapshots = 0,
      bootstraps = 0;
    const cursors = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== api.apiOrigin) return;
      if (url.pathname.endsWith('/events') && request.method() === 'GET') {
        opens++;
        cursors.push(request.headers()['last-event-id'] ?? null);
      }
      if (url.pathname.endsWith('/snapshot')) snapshots++;
      if (url.pathname.endsWith('/session') && request.method() === 'POST') bootstraps++;
    });
    await page.goto(origin + '/tests/fixtures/realtime.html');
    const bootstrapped = await page.evaluate(
      async ({ base, displayId, secret }) => {
        const response = await fetch(base + '/api/overlays/' + displayId + '/session', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret }),
        });
        return response.status;
      },
      { base: api.apiOrigin, displayId, secret },
    );
    assert.equal(bootstrapped, 200);
    const parameters = new URLSearchParams({
      displayId,
      grantId,
      ...(protocol === 2 ? { protocolVersion: '2' } : {}),
    });
    await page.goto(origin + '/tests/fixtures/realtime.html?' + parameters.toString());
    await page
      .getByTestId('connection-phase')
      .filter({ hasText: /^live$/ })
      .waitFor();
    const initialVersion = Number(await page.getByTestId('projection-version').textContent());
    const firstOpens = opens;
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(opens, firstOpens);
    assert.ok(snapshots >= 1);
    assert.equal(bootstraps, 1);
    if (protocol === 2)
      assert.equal(await page.getByTestId('template-id').textContent(), 'standalone');
    checks.push(
      `v${protocol}: real cookie bootstrap, SSE resync and same-connection HTTP snapshot`,
    );
    const deniedWrite = await page.evaluate(
      async (base) =>
        (
          await fetch(base + '/api/overlay-grants', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
      api.apiOrigin,
    );
    assert.equal(deniedWrite, 401);
    checks.push(`v${protocol}: reader proof cannot issue owner grants`);
    const preferences = await command(
      '/api/overlay-preferences' + (protocol === 2 ? '?protocolVersion=2' : ''),
      'GET',
    );
    await command(
      '/api/overlay-preferences' + (protocol === 2 ? '?protocolVersion=2' : ''),
      'PATCH',
      {
        expectedVersion: preferences.data.version,
        styles: { ...preferences.data.styles, opacity: protocol === 1 ? 0.7 : 0.6 },
      },
    );
    await expect
      .poll(async () => Number(await page.getByTestId('projection-version').textContent()))
      .toBeGreaterThan(initialVersion);
    checks.push(
      `v${protocol}: committed SQL preference change arrives as a newer stream projection`,
    );
    const version = Number(await page.getByTestId('projection-version').textContent());
    api.interruptConnections();
    await page
      .getByTestId('connection-phase')
      .filter({ hasText: /^reconnecting$/ })
      .waitFor();
    assert.equal(await page.getByTestId('projection-version').textContent(), 'hidden');
    await page
      .getByTestId('connection-phase')
      .filter({ hasText: /^live$/ })
      .waitFor();
    assert.equal(Number(await page.getByTestId('projection-version').textContent()), version);
    assert.ok(cursors.some((cursor) => cursor === `${displayId}.v${version}`));
    assert.equal(bootstraps, 1);
    checks.push(
      `v${protocol}: actual socket loss hides content, then cursor reconnect reauthorizes without bootstrap`,
    );
    await command('/api/overlay-grants/' + grantId, 'DELETE');
    await page
      .getByTestId('connection-phase')
      .filter({ hasText: /^denied$/ })
      .waitFor();
    assert.equal(await page.getByTestId('projection-version').textContent(), 'hidden');
    const stoppedAt = opens;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.equal(opens, stoppedAt);
    assert.deepEqual(
      await page.evaluate(() => [localStorage.length, sessionStorage.length]),
      [0, 0],
    );
    checks.push(
      `v${protocol}: persisted grant revocation ends the stream and stops unauthorized retries`,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  const record = {
    source: api.source,
    migrations: api.migrations,
    checks,
    pageErrors: errors,
    realPostgres: true,
    realRedis: true,
    providerCalls: false,
    externalIdentityVerified: false,
    obsVerified: false,
  };
  mkdirSync('artifacts.local/f02-03', { recursive: true });
  writeFileSync('artifacts.local/f02-03/acceptance.json', JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
} finally {
  const cleanup = await Promise.allSettled([browser?.close(), vite?.close(), api?.close()]);
  if (cleanup.some((result) => result.status === 'rejected')) {
    process.stderr.write('Realtime acceptance cleanup failed; inspect the recorded owned run.\n');
    process.exitCode = 1;
  }
}
