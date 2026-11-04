import { afterEach, expect, it, vi } from 'vitest';
import jsQR from 'jsqr';
import { createCreatorSession, type CreatorSession } from '@/services/creator-session/index';
import { readOverlayLocation, createOverlayReader } from './reader';
import { createOverlayOwner } from './owner';
import { qrMatrix } from './qr';
const secret = 's'.repeat(43),
  origin = 'https://api.example.test';
const displayId = '11223344-1234-4234-8234-112233445566',
  grantId = '22334455-1234-4234-8234-112233445566',
  foreignId = '33445566-1234-4234-8234-112233445566';
const syntheticReportingSession = {
  authenticated: true,
  user: {
    id: displayId,
    displayName: 'Synthetic OBS owner',
    termsStatus: {
      status: 'accepted',
      documentId: 'synthetic',
      requiredVersion: 'v1',
      classification: 'development',
      contentHash: 'a'.repeat(64),
      acceptedVersion: 'v1',
      acceptedAt: '2026-11-02T12:00:00.000Z',
    },
  },
  expiresAt: '2030-01-01T00:00:00.000Z',
  csrfToken: 'a'.repeat(43),
};
const envelope = (data: unknown) => ({
  schemaVersion: 1,
  serverTime: new Date().toISOString(),
  data,
});
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const sessions: CreatorSession[] = [];
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions.length = 0;
  vi.restoreAllMocks();
});
it('consumes only exact private fragment or sanitized matching reader identity', () => {
  expect(
    readOverlayLocation(`https://display.example.test/overlay/${displayId}#grant=${secret}`),
  ).toEqual({ displayId, secret, grantId: null });
  expect(
    readOverlayLocation(`https://display.example.test/overlay/${displayId}#grantId=${grantId}`)
      ?.grantId,
  ).toBe(grantId);
  for (const tail of [
    `?secret=${secret}#grant=${secret}`,
    `#grant=${secret}&grantId=${grantId}`,
    `#grant=${secret}&grant=${secret}`,
    '#grant=short',
    '#token=private',
    '',
  ])
    expect(
      readOverlayLocation(`https://display.example.test/overlay/${displayId}${tail}`),
    ).toBeNull();
});
it('bootstrap is separate from creator authority and denies a foreign display response', async () => {
  const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json(envelope({ displayId: foreignId, grantId }))),
    replace = vi.fn();
  const entry = { displayId, secret, grantId: null };
  const reader = createOverlayReader({
    origin,
    entry,
    fetcher,
    replace,
  });
  reader.start();
  await vi.waitFor(() => expect(reader.getSnapshot().phase).toBe('denied'));
  expect(entry.secret).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(replace).not.toHaveBeenCalled();
  const init = fetcher.mock.calls[0]![1]!;
  expect(init.credentials).toBe('include');
  expect(new Headers(init.headers).has('X-CSRF-Token')).toBe(false);
  expect(JSON.parse(init.body as string)).toEqual({ secret });
  reader.dispose();
});
it('disposed bootstrap cannot install a cookie identity or start a stream from a late result', async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
    replace = vi.fn();
  const reader = createOverlayReader({
    origin,
    entry: { displayId, secret, grantId: null },
    fetcher,
    replace,
  });
  reader.start();
  reader.dispose();
  resolve(json(envelope({ displayId, grantId })));
  await new Promise((done) => setTimeout(done, 10));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(replace).not.toHaveBeenCalled();
  expect(reader.getSnapshot().snapshot).toBeNull();
});
it('OBS visibility returning during bootstrap can recover the same read-only grant', async () => {
  let settle!: (response: Response) => void;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 503 }))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        }),
    )
    .mockResolvedValueOnce(json(envelope({ displayId, grantId })));
  const replace = vi.fn(),
    reader = createOverlayReader({
      origin,
      entry: { displayId, secret, grantId: null },
      fetcher,
      replace,
    });
  try {
    reader.start();
    window.dispatchEvent(
      new CustomEvent('obsSourceVisibleChanged', { detail: { visible: false } }),
    );
    window.dispatchEvent(new CustomEvent('obsSourceVisibleChanged', { detail: { visible: true } }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('#grantId=' + grantId), {
      timeout: 250,
    });
    expect(
      fetcher.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].endsWith('/session?protocolVersion=2'),
      ),
    ).toHaveLength(2);
  } finally {
    reader.dispose();
    settle(json(envelope({ displayId, grantId })));
  }
});
it('invalid entry makes no request and does not try creator authentication or grant issuance', () => {
  const fetcher = vi.fn<typeof fetch>(),
    reader = createOverlayReader({ origin, entry: null, fetcher, replace: vi.fn() });
  reader.start();
  expect(reader.getSnapshot().phase).toBe('unavailable');
  expect(fetcher).not.toHaveBeenCalled();
  reader.dispose();
});
async function owner() {
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(json(syntheticReportingSession));
  const session = createCreatorSession({ origin, fetcher: send });
  sessions.push(session);
  session.start();
  await session.inspect();
  return { send, session, client: createOverlayOwner(session) };
}
it('owner selection uses exact optimistic binding and rejects a foreign acknowledgement', async () => {
  const { send, client } = await owner();
  send.mockResolvedValueOnce(
    json(envelope({ displayId: foreignId, version: 2, roundId: grantId, challengeId: foreignId })),
  );
  await expect(
    client.select(displayId, { expectedVersion: 1, roundId: grantId, challengeId: foreignId }),
  ).rejects.toThrow();
  expect(send.mock.calls[1]![1]!.method).toBe('PUT');
  expect(JSON.parse(send.mock.calls[1]![1]!.body as string)).toEqual({
    expectedVersion: 1,
    roundId: grantId,
    challengeId: foreignId,
  });
  expect(new Headers(send.mock.calls[1]![1]!.headers).get('X-CSRF-Token')).toBeTruthy();
});
it('owner commands are fenced after session disposal', async () => {
  const { send, session, client } = await owner();
  session.stop();
  await expect(client.issue()).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
});
it('locally encoded exact challenge URL independently decodes with its quiet zone at 1080p and 720p scale', () => {
  const payload = `https://darve.example.test/contribute/${foreignId}`,
    qr = qrMatrix(payload)!;
  expect(qr).not.toBeNull();
  // Rasterize the exact generated SVG module paths independently of the encoder.
  const points = [...qr.path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(
    (m) => [Number(m[1]), Number(m[2])] as const,
  );
  for (const size of [150, 100]) {
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (
          points.some(
            ([cx, cy]) =>
              Math.floor((x * qr.size) / size) === cx && Math.floor((y * qr.size) / size) === cy,
          )
        ) {
          const i = (y * size + x) * 4;
          pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
        }
    expect(jsQR(pixels, size, size)?.data).toBe(payload);
  }
  expect(qrMatrix('javascript:alert(1)')).toBeNull();
  expect(qrMatrix('https://user:password@example.test/c')).toBeNull();
});
