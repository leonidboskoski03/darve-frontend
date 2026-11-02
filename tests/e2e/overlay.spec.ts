import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import jsQR from 'jsqr';
import {
  acceptedFrame,
  displayId,
  grantId,
} from '../../src/services/realtime/fixtures.test-support';
import { OverlaySnapshotV2ResponseSchema } from '../../src/services/contracts/index';
import {
  syntheticReportingSession,
  reportingChallenge,
} from '../../src/services/reporting/fixture.test-helper';
const origin = 'http://127.0.0.1:4175',
  base = origin + '/tests/fixtures/overlay.html?displayId=' + displayId;
type Frame = ReturnType<typeof OverlaySnapshotV2ResponseSchema.parse>;
declare global {
  interface Window {
    syntheticOverlay: { emit(frame: Frame): void; calls: string[]; bootstrap: number };
  }
}
async function display(page: Page) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.clock.install();
  const frame = OverlaySnapshotV2ResponseSchema.parse(acceptedFrame(2));
  await page.addInitScript(
    ({ frame, displayId, grantId }) => {
      const original = window.fetch.bind(window),
        sources = new Set<ReadableStreamDefaultController<Uint8Array>>();
      let current = frame;
      const event = (data: typeof frame, type = 'overlay.snapshot') =>
        `id: ${displayId}.v${data.data.version}\nevent: ${type}\ndata: ${JSON.stringify({ schemaVersion: 2, eventId: `${displayId}.v${data.data.version}`, occurredAt: data.serverTime, resourceType: 'overlay', resourceId: displayId, resourceVersion: data.data.version, type, data: data.data })}\n\n`;
      const control = {
        calls: [] as string[],
        bootstrap: 0,
        emit(data: typeof frame) {
          current = data;
          for (const source of sources) source.enqueue(new TextEncoder().encode(event(data)));
        },
      };
      window.syntheticOverlay = control;
      window.fetch = (input, init) => {
        const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        );
        if (url.origin !== 'http://127.0.0.1:3310') return original(input, init);
        control.calls.push(url.pathname);
        if (url.pathname.endsWith('/session')) {
          control.bootstrap++;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                schemaVersion: 1,
                serverTime: frame.serverTime,
                data: { displayId, grantId },
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        if (url.pathname.endsWith('/snapshot'))
          return Promise.resolve(
            new Response(JSON.stringify(current), {
              headers: { 'content-type': 'application/json' },
            }),
          );
        if (!url.pathname.endsWith('/events'))
          return Promise.reject(new Error('Unexpected synthetic request'));
        let source: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            source = controller;
            sources.add(controller);
            controller.enqueue(
              new TextEncoder().encode(
                event(
                  {
                    ...current,
                    serverTime: new Date(Date.parse(current.serverTime) - 1000).toISOString(),
                  },
                  'resync_required',
                ),
              ),
            );
          },
          cancel() {
            sources.delete(source);
          },
        });
        init?.signal?.addEventListener(
          'abort',
          () => {
            if (sources.delete(source)) source.close();
          },
          { once: true },
        );
        return Promise.resolve(
          new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
        );
      };
    },
    { frame, displayId, grantId },
  );
  await page.goto(base + '#grant=' + 's'.repeat(43));
  await expect(page.getByRole('heading', { name: 'Synthetic challenge' })).toBeVisible();
  return frame;
}
test('synthetic OBS bootstrap sanitizes before reads, isolates assets and preserves exact money', async ({
  page,
}) => {
  await display(page);
  expect(page.url()).toBe(`${origin}/overlay/${displayId}#grantId=${grantId}`);
  await expect(page.getByText('90071992547409.92 EUR', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.syntheticOverlay.bootstrap)).toBe(1);
  expect(
    await page.evaluate(() =>
      window.syntheticOverlay.calls.every((path) => path.startsWith('/api/overlays/')),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  if (test.info().project.name === 'desktop-chromium')
    await page
      .locator('.obs-card')
      .screenshot({ path: 'artifacts.local/f07/overlay-synthetic.png', omitBackground: true });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgba(0, 0, 0, 0)',
  );
});
test('synthetic rendered QR pixels independently decode to the exact selected public URL at two stream scales', async ({
  page,
}) => {
  const frame = await display(page);
  const svg = page.getByRole('img', { name: 'Scan to view this challenge' });
  for (const size of [150, 100]) {
    const pixels = await svg.evaluate(async (node, size) => {
      const image = new Image();
      image.src =
        'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(new XMLSerializer().serializeToString(node));
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0, size, size);
      return Array.from(ctx.getImageData(0, 0, size, size).data);
    }, size);
    expect(jsQR(new Uint8ClampedArray(pixels), size, size)?.data).toBe(frame.data.qrPayload);
  }
});
test('synthetic OBS stale content hides immediately and only a new validated frame restores it', async ({
  page,
}) => {
  const frame = await display(page);
  await page.clock.runFor(16000);
  await expect(page.locator('.obs-card')).toHaveCount(0);
  frame.serverTime = new Date(Date.parse(frame.serverTime) + 17000).toISOString();
  await page.evaluate((frame) => window.syntheticOverlay.emit(frame), frame);
  await expect(page.getByRole('heading', { name: 'Synthetic challenge' })).toBeVisible();
});
test('synthetic OBS visibility and activation events clear presentation and reacquire fresh cookie-only state', async ({
  page,
}) => {
  await display(page);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('obsSourceVisibleChanged', { detail: { visible: false } }),
    ),
  );
  await expect(page.locator('.obs-card')).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('obsSourceActiveChanged', { detail: { active: false } })),
  );
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('obsSourceVisibleChanged', { detail: { visible: true } })),
  );
  await expect(page.locator('.obs-card')).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('obsSourceActiveChanged', { detail: { active: true } })),
  );
  await expect(page.locator('.obs-card')).toBeVisible();
  expect(await page.evaluate(() => window.syntheticOverlay.bootstrap)).toBe(1);
});
test('synthetic selected source removal and unsupported templates do not retain content or QR', async ({
  page,
}) => {
  const frame = await display(page);
  frame.data.version++;
  frame.data.preferences.template.available = false;
  await page.evaluate((frame) => window.syntheticOverlay.emit(frame), frame);
  await expect(page.locator('.obs-card')).toHaveCount(0);
  frame.data.version++;
  frame.data.preferences.template.available = true;
  frame.data.presentationState = 'accepted_unavailable';
  frame.data.challenge!.contentAvailability = 'unavailable';
  frame.data.challenge!.terms.text = null;
  frame.data.qrPayload = null;
  await page.evaluate((frame) => window.syntheticOverlay.emit(frame), frame);
  await expect(page.locator('.obs-card')).toHaveCount(0);
});
test('synthetic funded and declared projections remain distinct and suppress contribution QR', async ({
  page,
}) => {
  const frame = await display(page);
  frame.data.version++;
  frame.data.presentationState = 'accepted_closed';
  frame.data.qrPayload = null;
  frame.data.challenge!.funding.state = 'funded';
  frame.data.challenge!.performance.state = 'awaiting_performance';
  await page.evaluate((frame) => window.syntheticOverlay.emit(frame), frame);
  await expect(page.getByText('Goal reached', { exact: true })).toBeVisible();
  await expect(page.getByText('Streamer declared complete')).toHaveCount(0);
  await expect(page.getByRole('img')).toHaveCount(0);
  frame.data.version++;
  frame.data.challenge!.performance = {
    ...frame.data.challenge!.performance,
    revision: 2,
    state: 'declared_complete',
    declarationId: grantId,
    declaredAt: frame.serverTime,
    streamContextStatus: 'confirmed_original_broadcast',
  };
  await page.evaluate((frame) => window.syntheticOverlay.emit(frame), frame);
  await expect(page.getByText('Streamer declared complete', { exact: true })).toBeVisible();
  await expect(page.getByRole('img')).toHaveCount(0);
});
test('synthetic closed contribution window retains challenge without QR and never declares performance', async ({
  page,
}) => {
  const frame = await display(page);
  frame.data.version++;
  frame.data.presentationState = 'accepted_closed';
  frame.data.qrPayload = null;
  await page.evaluate((frame) => window.syntheticOverlay.emit(frame), frame);
  await expect(page.getByRole('heading', { name: 'Synthetic challenge' })).toBeVisible();
  await expect(page.getByRole('img')).toHaveCount(0);
  await expect(page.getByText('Contribution window closed', { exact: true })).toBeVisible();
  await expect(page.getByText('Streamer declared complete')).toHaveCount(0);
});
const envelope = (data: unknown) => ({
  schemaVersion: 1,
  serverTime: new Date().toISOString(),
  data,
});
const cors = {
  'access-control-allow-origin': origin,
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'X-CSRF-Token,Content-Type',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
};
async function owner(page: Page) {
  const frame = OverlaySnapshotV2ResponseSchema.parse(acceptedFrame(2));
  const state = {
    issued: 0,
    selected: [] as unknown[],
    saved: [] as unknown[],
    revoked: 0,
    selection: {
      displayId,
      version: 1,
      roundId: null as string | null,
      challengeId: null as string | null,
    },
    preferences: frame.data.preferences,
    stale: false,
  };
  const reply = (route: Route, data: unknown, status = 200) =>
    route.fulfill({
      status,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  await page.route('http://127.0.0.1:3310/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method();
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (url.pathname === '/api/session') {
      await reply(route, syntheticReportingSession);
      return;
    }
    if (url.pathname === '/api/challenges') {
      await reply(route, envelope({ items: [reportingChallenge()], nextCursor: null }));
      return;
    }
    if (url.pathname === '/api/overlay-preferences') {
      if (method === 'PATCH') {
        const body = request.postDataJSON() as { styles: typeof state.preferences.styles };
        state.saved.push(request.postDataJSON());
        state.preferences = {
          ...state.preferences,
          version: state.preferences.version + 1,
          styles: body.styles,
        };
      }
      await reply(route, {
        schemaVersion: 2,
        serverTime: frame.serverTime,
        data: state.preferences,
      });
      return;
    }
    if (url.pathname === '/api/overlay-grants') {
      state.issued++;
      await reply(
        route,
        envelope({
          id: grantId,
          displayId,
          expiresAt: null,
          selection: state.selection,
          presentationUrl: `${origin}/overlay/${displayId}#grant=${'s'.repeat(43)}`,
        }),
        201,
      );
      return;
    }
    if (url.pathname.startsWith('/api/overlay-grants/')) {
      state.revoked++;
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (url.pathname.endsWith('/selection')) {
      state.selected.push(request.postDataJSON());
      if (state.stale) {
        await reply(
          route,
          {
            schemaVersion: 1,
            serverTime: frame.serverTime,
            error: {
              code: 'STALE_VERSION',
              message: 'private',
              requestId: 'test',
              retryable: false,
              retryAfterSeconds: null,
              issues: [],
              refetch: null,
            },
          },
          409,
        );
        return;
      }
      state.selection = {
        ...request.postDataJSON(),
        displayId,
        version: 2,
      } as typeof state.selection;
      delete (state.selection as Record<string, unknown>).expectedVersion;
      await reply(route, envelope(state.selection));
      return;
    }
    if (url.pathname.startsWith('/api/overlay-displays/')) {
      await reply(route, envelope(state.selection));
      return;
    }
    await reply(route, envelope({}), 404);
  });
  await page.goto(origin + '/tests/fixtures/creator.html?view=obs&displayId=' + displayId);
  await expect(page.getByRole('heading', { name: 'OBS display', exact: true })).toBeVisible();
  return state;
}
test('synthetic owner controls never issue on mount and require separate review for link, selection and settings', async ({
  page,
}) => {
  const state = await owner(page);
  expect(state.issued).toBe(0);
  await page.getByRole('checkbox', { name: /I understand this read-only link/ }).check();
  await page.getByRole('button', { name: 'Create private OBS link' }).click();
  await expect(page.getByLabel('Private browser-source URL')).toHaveValue(/#grant=/);
  expect(state.issued).toBe(1);
  await expect(page.getByRole('button', { name: 'Create private OBS link' })).toBeDisabled();
  await page.getByRole('button', { name: 'Review for display' }).click();
  await expect(page.getByRole('button', { name: 'Confirm display selection' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Show this selection/ }).check();
  await page.getByRole('button', { name: 'Confirm display selection' }).click();
  await expect.poll(() => state.selected.length).toBe(1);
  await page.getByLabel('Opacity', { exact: true }).fill('0.7');
  await page.getByRole('checkbox', { name: /Apply these settings/ }).check();
  await page.getByRole('button', { name: 'Save display settings' }).click();
  await expect.poll(() => state.saved.length).toBe(1);
  await page.getByRole('checkbox', { name: /Revoke this link/ }).check();
  await page.getByRole('button', { name: 'Revoke OBS link' }).click();
  await expect.poll(() => state.revoked).toBe(1);
  await expect(page.getByLabel('Private browser-source URL')).toHaveCount(0);
});
test('synthetic stale selection requires refreshed renewed review without an automatic command replay', async ({
  page,
}) => {
  const state = await owner(page);
  state.stale = true;
  await page.getByRole('button', { name: 'Review for display' }).click();
  await page.getByRole('checkbox', { name: /Show this selection/ }).check();
  await page.getByRole('button', { name: 'Confirm display selection' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'display changed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm display selection' })).toHaveCount(0);
  expect(state.selected.length).toBe(1);
});
test('synthetic OBS settings support keyboard, 320px reflow, reduced motion and accessible controls', async ({
  page,
}) => {
  await owner(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('production isolated entry stays transparent without credentials and never loads creator navigation', async ({
  page,
}) => {
  const paths: string[] = [];
  page.on('request', (request) => paths.push(request.url()));
  await page.goto(`http://127.0.0.1:4173/overlay/${displayId}#grantId=${grantId}`);
  await expect(page.locator('[data-obs-phase="unavailable"]')).toHaveCount(1);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  expect(
    paths.some(
      (path) =>
        path.includes('/api/session') ||
        path.includes('landing') ||
        path.includes('workspace-layout'),
    ),
  ).toBe(false);
});
