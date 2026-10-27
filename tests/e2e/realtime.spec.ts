import { test, expect } from '@playwright/test';
const displayId = '11223344-1234-4234-8234-112233445566';
const grantId = '22334455-1234-4234-8234-112233445566';
function makeFrame(protocol: 1 | 2, version = 1, seconds = 0) {
  const styles = { position: 'bottom_left', scale: 1, opacity: 1, marginX: 0, marginY: 0 };
  return {
    schemaVersion: protocol,
    serverTime: new Date(Date.parse('2026-10-27T12:00:00.000Z') + seconds * 1000).toISOString(),
    data: {
      id: displayId,
      version,
      bindingVersion: 1,
      presentationState: 'idle',
      roundId: null,
      challengeId: null,
      collectionClosesAt: null,
      challenge: null,
      qrPayload: null,
      preferences:
        protocol === 1
          ? { version: 1, styles: { ...styles, themeStyle: 'standalone' } }
          : {
              version: 1,
              styles,
              template: {
                revision: 1,
                templateId: 'standalone',
                assetVersion: 1,
                available: true,
                renderer: { key: 'standalone', hash: null },
              },
            },
    },
  };
}
function makeEvent(frame: ReturnType<typeof makeFrame>, type = 'overlay.snapshot') {
  return {
    schemaVersion: frame.schemaVersion,
    eventId: `${displayId}.v${frame.data.version}`,
    occurredAt: frame.serverTime,
    resourceType: 'overlay',
    resourceId: displayId,
    resourceVersion: frame.data.version,
    type,
    data: frame.data,
  };
}
const wireEvent = (event: ReturnType<typeof makeEvent>) =>
  `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

type SyntheticControl = { emit(text: string): void; opens: number; active: number };
declare global {
  interface Window {
    syntheticRealtime: SyntheticControl;
  }
}

for (const protocol of [1, 2] as const) {
  test(`synthetic v${protocol} stream hides stale content, recovers on a validated clock frame and cleans up`, async ({
    page,
  }) => {
    await page.clock.install();
    const frame = makeFrame(protocol, 1, 1);
    await page.addInitScript(
      ({ frame, first }) => {
        const original = window.fetch.bind(window);
        const sources = new Set<ReadableStreamDefaultController<Uint8Array>>();
        const controls: SyntheticControl = {
          opens: 0,
          active: 0,
          emit(text) {
            for (const controller of sources) controller.enqueue(new TextEncoder().encode(text));
          },
        };
        window.syntheticRealtime = controls;
        window.fetch = (input, init) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (!url.startsWith('http://127.0.0.1:3310/')) return original(input, init);
          if (url.includes('/snapshot?'))
            return Promise.resolve(
              new Response(JSON.stringify(frame), {
                headers: { 'content-type': 'application/json' },
              }),
            );
          if (!url.includes('/events?'))
            return Promise.reject(new Error('Unexpected synthetic endpoint.'));
          if (init?.signal?.aborted)
            return Promise.reject(new DOMException('Cancelled', 'AbortError'));
          controls.opens++;
          let source: ReadableStreamDefaultController<Uint8Array>;
          const retire = (close: boolean) => {
            if (sources.delete(source)) {
              controls.active--;
              if (close) source.close();
            }
          };
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              source = controller;
              sources.add(controller);
              controls.active++;
              controller.enqueue(new TextEncoder().encode(first));
            },
            cancel() {
              retire(false);
            },
          });
          init?.signal?.addEventListener('abort', () => retire(true), { once: true });
          return Promise.resolve(
            new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
          );
        };
      },
      { frame, first: wireEvent(makeEvent(makeFrame(protocol), 'resync_required')) },
    );
    await page.goto(
      `http://127.0.0.1:4175/tests/fixtures/realtime.html?displayId=${displayId}&grantId=${grantId}${protocol === 2 ? '&protocolVersion=2' : ''}`,
    );
    await expect(page.getByTestId('connection-phase')).toHaveText('live');
    await expect(page.getByTestId('projection-version')).toHaveText('1');
    expect(await page.evaluate(() => window.syntheticRealtime.active)).toBe(1);
    await page.evaluate(() => window.syntheticRealtime.emit(': keep-alive\n\n'));
    await page.clock.runFor(16_000);
    await expect(page.getByTestId('connection-phase')).toHaveText('stale');
    await expect(page.getByTestId('projection-version')).toHaveText('hidden');
    await page.evaluate(
      (wire) => window.syntheticRealtime.emit(wire),
      wireEvent(makeEvent(makeFrame(protocol, 1, 2))),
    );
    await expect(page.getByTestId('connection-phase')).toHaveText('live');
    await page.getByRole('button', { name: 'Stop subscription' }).click();
    await expect(page.getByTestId('connection-phase')).toHaveText('stopped');
    await expect(page.getByTestId('projection-version')).toHaveText('hidden');
    expect(await page.evaluate(() => window.syntheticRealtime.active)).toBe(0);
    const opens = await page.evaluate(() => window.syntheticRealtime.opens);
    await page.clock.runFor(60_000);
    expect(await page.evaluate(() => window.syntheticRealtime.opens)).toBe(opens);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  });
}
