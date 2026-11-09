import assert from 'node:assert/strict';
import { availableParallelism, platform, totalmem } from 'node:os';
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';

const budgets = {
  samples: 3,
  readyMedianMs: 2500,
  readyMaxMs: 5000,
  firstContentfulPaintMs: 3000,
  decodedScriptAndCssBytes: 1_100_000,
};

export function createQualityProbe(browser) {
  const routes = {};
  return {
    async measure(name, context, url, ready) {
      const samples = [];
      for (let trial = 0; trial < budgets.samples; trial++) {
        const page = await context.newPage();
        try {
          const cdp = await context.newCDPSession(page);
          await cdp.send('Network.enable');
          await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 });
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          await expect(ready(page)).toBeVisible();
          const sample = await page.evaluate(async () => {
            const readyMs = globalThis.performance.now();
            await globalThis.document.fonts.ready;
            await new Promise((resolve) =>
              globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
            );
            const perf = globalThis.performance;
            const origin = globalThis.location.origin;
            return {
              readyMs: Math.round(readyMs),
              firstContentfulPaintMs: Math.round(
                perf.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1,
              ),
              decodedScriptAndCssBytes: perf
                .getEntriesByType('resource')
                .filter(
                  (entry) =>
                    new URL(entry.name).origin === origin &&
                    /\.(?:js|css)$/.test(new URL(entry.name).pathname),
                )
                .reduce((total, entry) => total + entry.decodedBodySize, 0),
            };
          });
          samples.push(sample);
        } finally {
          await page.close();
        }
      }
      routes[name] = samples;
      const times = samples.map((sample) => sample.readyMs).sort((a, b) => a - b);
      assert(
        times[1] <= budgets.readyMedianMs && times[2] <= budgets.readyMaxMs,
        name + ' readiness budget',
      );
      for (const sample of samples) {
        assert(
          sample.firstContentfulPaintMs > 0 &&
            sample.firstContentfulPaintMs <= budgets.firstContentfulPaintMs,
          name + ' paint budget',
        );
        assert(
          sample.decodedScriptAndCssBytes > 0 &&
            sample.decodedScriptAndCssBytes <= budgets.decodedScriptAndCssBytes,
          name + ' JS/CSS budget',
        );
      }
    },
    report: () => ({
      budgets,
      routes,
      browser: browser.version(),
      platform: platform(),
      logicalWorkers: availableParallelism(),
      memoryGiB: Math.round(totalmem() / 2 ** 30),
      conditions:
        'Sequential fresh tabs on loopback, Chromium cache disabled, 2x renderer CPU throttle, no network throttle, one completed synthetic challenge with one payment and two recovery commands.',
    }),
  };
}

export async function auditMobile(page) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert(
    await page.evaluate(() => globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches),
  );
  const main = page.getByRole('main');
  await expect(main).toBeVisible();
  assert(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
  );
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  assert.deepEqual(
    violations.map(({ id }) => id),
    [],
  );
}

/** Wrap the real HTTP stream. Replay authentic wire frames without persisting their contents. */
export async function installReaderReplay(page) {
  await page.addInitScript(() => {
    const originalFetch = globalThis.fetch.bind(globalThis);
    const probe = { replays: 0, staleVersion: null, currentVersion: null };
    let pendingFrame;
    globalThis.__f10Replay = probe;
    globalThis.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get('content-type')?.includes('text/event-stream')
      )
        return response;
      const decoder = new globalThis.TextDecoder();
      const encoder = new globalThis.TextEncoder();
      let buffer = '';
      const stream = response.body.pipeThrough(
        new globalThis.TransformStream({
          transform(chunk, controller) {
            buffer += decoder.decode(chunk, { stream: true });
            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, boundary + 2);
              buffer = buffer.slice(boundary + 2);
              controller.enqueue(encoder.encode(frame));
              if (!frame.includes('event: overlay.')) continue;
              const body = JSON.parse(
                frame
                  .split('\n')
                  .find((line) => line.startsWith('data: '))
                  .slice(6),
              );
              const state = body.data.challenge?.funding.state;
              if (state === 'pending') pendingFrame = { frame, version: body.resourceVersion };
              if (
                state === 'funded' &&
                pendingFrame &&
                !probe.replays &&
                pendingFrame.version < body.resourceVersion
              ) {
                controller.enqueue(encoder.encode(frame + pendingFrame.frame));
                Object.assign(probe, {
                  replays: 2,
                  staleVersion: pendingFrame.version,
                  currentVersion: body.resourceVersion,
                });
              }
            }
          },
        }),
      );
      return new globalThis.Response(stream, {
        status: response.status,
        headers: response.headers,
      });
    };
  });
}

export async function inspectReaderReplay(page) {
  await page.waitForFunction(() => globalThis.__f10Replay?.replays === 2);
  const result = await page.evaluate(() => globalThis.__f10Replay);
  assert(result.currentVersion > result.staleVersion);
  await expect(page.getByText('Goal reached', { exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByRole('img', { name: 'Scan to view this challenge' })).toHaveCount(0);
}

export async function reconnectReader({ api, page, displayId }) {
  const streamPath = '/api/overlays/' + displayId + '/events';
  const streams = (url) => new URL(url).pathname === streamPath;
  let blocked = true;
  const cursors = [];
  const gate = async (route) => {
    cursors.push(route.request().headers()['last-event-id'] ?? '');
    if (blocked) await route.abort('internetdisconnected');
    else await route.continue();
  };
  await page.route(streams, gate);
  try {
    api.interruptConnections();
    await expect(page.locator('.obs-card')).toHaveCount(0);
    await expect.poll(() => cursors.length).toBeGreaterThan(0);
    blocked = false;
    await expect(page.getByText('Streamer declared complete', { exact: true })).toBeVisible({
      timeout: 12_000,
    });
    assert(cursors.some((cursor) => cursor.startsWith(displayId + '.v')));
  } finally {
    await page.unroute(streams, gate);
  }
}

export async function inspectPrivateReceipt({ api, probe, guestContext, page, checkoutId, check }) {
  await check(
    'mobile receipt reload and revocation hide private money without another checkout or capture',
    async () => {
      const before = await api.checkoutFixture.audit();
      const paymentWrites = [];
      guestContext.on('request', (request) => {
        if (request.method() === 'POST' && request.url().startsWith(api.apiOrigin))
          paymentWrites.push(request.method());
      });
      const verified = (target) =>
        target.getByRole('heading', { name: 'Verified payment recorded' });
      await page.reload();
      await expect(verified(page)).toBeVisible();
      await auditMobile(page);
      await page.getByRole('button', { name: 'Refresh receipt' }).focus();
      await page.keyboard.press('Enter');
      await expect(verified(page)).toBeVisible();
      await probe.measure('private-receipt', guestContext, page.url(), verified);
      const guest = (await guestContext.cookies(api.apiOrigin + '/api/checkouts')).find(
        (cookie) => cookie.name === 'darve_payment_guest',
      );
      assert(guest?.httpOnly);
      await api.checkoutFixture.revokeBrowser(guest.value);
      await page.getByRole('button', { name: 'Refresh receipt' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(verified(page)).toHaveCount(0);
      assert.equal(
        (await guestContext.request.get(api.apiOrigin + '/api/checkouts/' + checkoutId)).status(),
        401,
      );
      await page.reload();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.getByText('Recorded Darve fee', { exact: true })).toHaveCount(0);
      const after = await api.checkoutFixture.audit();
      assert.deepEqual(
        [after.attempts, after.payments, after.captures],
        [before.attempts, before.payments, before.captures],
      );
      assert.deepEqual(paymentWrites, []);
    },
  );
}
