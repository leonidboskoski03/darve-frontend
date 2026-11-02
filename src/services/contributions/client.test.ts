import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createContributionRuntime,
  createContributionController,
  contributionMoney,
  fundingPercent,
} from './client';
import { sanitizePaymentReturn } from './navigation';
import {
  contributionIds as ids,
  publicContributionFixture,
  privateReceiptFixture,
} from './fixture.test-helper';
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const signal = () => new AbortController().signal;
const owned: ReturnType<typeof createContributionRuntime>[] = [];
const runtime = (send = vi.fn<typeof fetch>()) => {
  const next = createContributionRuntime({
    origin: 'https://api.example.test',
    fetcher: send,
    watch: false,
  });
  owned.push(next);
  return next;
};
afterEach(() => {
  owned.forEach((item) => item.dispose());
  owned.length = 0;
});
describe('public contribution and independent private receipt reads', () => {
  it('omits cookies on the public read and never starts a creator or monetary command', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(response(publicContributionFixture()));
    await runtime(send).challenge(ids.public, signal());
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe(
      'https://api.example.test/api/public/challenges/' + ids.public,
    );
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    expect(new Headers(send.mock.calls[0]?.[1]?.headers).get('X-CSRF-Token')).toBeNull();
    expect(new Headers(send.mock.calls[0]?.[1]?.headers).get('Idempotency-Key')).toBeNull();
  });
  it.each(['../private', 'not-an-id', ids.public + '?secret=proof'])(
    'rejects an invalid reference before transport: %s',
    async (id) => {
      const send = vi.fn<typeof fetch>(),
        client = runtime(send);
      await expect(client.challenge(id, signal())).rejects.toMatchObject({
        problem: { category: 'configuration' },
      });
      await expect(client.receipt(id, signal())).rejects.toMatchObject({
        problem: { category: 'configuration' },
      });
      expect(send).not.toHaveBeenCalled();
    },
  );
  it('rejects a schema-valid foreign public ID', async () => {
    const body = publicContributionFixture();
    body.data.publicId = ids.other;
    await expect(
      runtime(vi.fn<typeof fetch>().mockResolvedValue(response(body))).challenge(
        ids.public,
        signal(),
      ),
    ).rejects.toMatchObject({ problem: { category: 'protocol' } });
  });
  it('does not invent an available payment variant absent from the pinned public contract', async () => {
    const body = publicContributionFixture();
    const raw = { ...body, data: { ...body.data, checkoutAvailability: { available: true } } };
    await expect(
      runtime(vi.fn<typeof fetch>().mockResolvedValue(response(raw))).challenge(
        ids.public,
        signal(),
      ),
    ).rejects.toMatchObject({ problem: { category: 'protocol' } });
  });
  it('rejects duplicate provider rows instead of mislabelling coverage', async () => {
    const body = publicContributionFixture();
    body.data.availablePaymentProviders[1]!.provider = 'stripe';
    await expect(
      runtime(vi.fn<typeof fetch>().mockResolvedValue(response(body))).challenge(
        ids.public,
        signal(),
      ),
    ).rejects.toMatchObject({ problem: { category: 'protocol' } });
  });
  it.each(['stripe', 'paypal'] as const)(
    'reads only the cookie-owned %s receipt, preserving exact amounts and no redirect',
    async (provider) => {
      const send = vi
          .fn<typeof fetch>()
          .mockResolvedValue(response(privateReceiptFixture(provider))),
        client = runtime(send);
      const value = await client.receipt(ids.checkout, signal());
      expect(value).toMatchObject({
        id: ids.checkout,
        paymentStatus: 'unconfirmed',
        amount: { amountMinor: '9007199254740993', decimal: '90071992547409.93' },
        createdAt: '2026-11-02T12:00:00.000Z',
      });
      expect(value).not.toHaveProperty('nextAction');
      expect(send.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', credentials: 'include' });
      expect(send.mock.calls[0]?.[1]?.body).toBeUndefined();
      expect(client.scope.audience).toBe('guest');
      expect(client.scope.queryClient).not.toBe(client.publicQueries);
    },
  );
  it('binds receipt ID and amount/fee currency before exposing data', async () => {
    for (const field of ['id', 'currency']) {
      const body = privateReceiptFixture();
      if (field === 'id') body.data.id = ids.other;
      else body.data.darveFee.currency = 'USD';
      await expect(
        runtime(vi.fn<typeof fetch>().mockResolvedValue(response(body))).receipt(
          ids.checkout,
          signal(),
        ),
      ).rejects.toMatchObject({ problem: { category: 'protocol' } });
    }
  });
  it.each(['eligible', 'late', 'unclassified'] as const)(
    'retains verified money and %s timing independently from funding/performance',
    async (eligibility) => {
      const body = privateReceiptFixture();
      body.data.state = 'succeeded';
      body.data.payments.push({
        id: ids.payment,
        amountMinor: '1007',
        paidAt: null,
        eligibilityReferenceAt: eligibility === 'unclassified' ? null : body.serverTime,
        eligibilityTimeBasis: eligibility === 'unclassified' ? 'unknown' : 'stripe_success_event',
        eligibility,
      });
      expect(
        await runtime(vi.fn<typeof fetch>().mockResolvedValue(response(body))).receipt(
          ids.checkout,
          signal(),
        ),
      ).toMatchObject({
        paymentStatus: 'confirmed',
        verifiedPayments: [{ eligibility, paidAt: null }],
      });
    },
  );
  it.each([401, 403, 404, 503])(
    'keeps private denial/outage safe and sends no recovery POST (%s)',
    async (status) => {
      const send = vi.fn<typeof fetch>().mockResolvedValue(
        response(
          {
            schemaVersion: 1,
            error: {
              code: 'UNAUTHORIZED',
              message: 'raw private context',
              requestId: 'synthetic',
              retryAfterSeconds: null,
            },
          },
          status,
        ),
      );
      await expect(runtime(send).receipt(ids.checkout, signal())).rejects.toBeInstanceOf(Error);
      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0]?.[1]?.method).toBe('GET');
    },
  );
  it('clears only private cache on a recheck and fences a late older receipt', async () => {
    let settle!: (response: Response) => void;
    const send = vi.fn<typeof fetch>().mockImplementation(
        () =>
          new Promise((resolve) => {
            settle = resolve;
          }),
      ),
      client = runtime(send);
    client.publicQueries.setQueryData(['public'], 'public');
    client.scope.queryClient.setQueryData(['private'], 'private');
    const pending = client.receipt(ids.checkout, signal());
    client.refreshPrivate();
    settle(response(privateReceiptFixture()));
    await expect(pending).rejects.toMatchObject({ problem: { category: 'authority' } });
    expect(client.scope.queryClient.getQueryData(['private'])).toBeUndefined();
    expect(client.publicQueries.getQueryData(['public'])).toBe('public');
  });
  it('aborts disposed authority and refuses reuse', async () => {
    const send = vi.fn<typeof fetch>(),
      client = runtime(send);
    client.dispose();
    await expect(client.receipt(ids.checkout, signal())).rejects.toMatchObject({
      problem: { category: 'authority' },
    });
    expect(client.scope.signal.aborted).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
  it('hides background receipt data and requires a new read after page restoration', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(response(privateReceiptFixture()));
    const client = createContributionRuntime({ origin: 'https://api.example.test', fetcher: send });
    owned.push(client);
    client.scope.queryClient.setQueryData(['private'], 'prior receipt');
    window.dispatchEvent(new Event('pagehide'));
    expect(client.getSnapshot().visible).toBe(false);
    expect(client.scope.queryClient.getQueryData(['private'])).toBeUndefined();
    await expect(client.receipt(ids.checkout, signal())).rejects.toMatchObject({
      problem: { category: 'authority' },
    });
    expect(send).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pageshow'));
    await expect(client.receipt(ids.checkout, signal())).resolves.toMatchObject({
      paymentStatus: 'unconfirmed',
    });
    expect(send).toHaveBeenCalledOnce();
  });
  it('drops transient provider destinations from status rather than exposing a payable action', async () => {
    const body = privateReceiptFixture();
    body.data.nextAction = {
      type: 'redirect',
      url: 'https://untrusted.example.test/private-provider-context',
    };
    const send = vi.fn<typeof fetch>().mockResolvedValue(response(body));
    const value = await runtime(send).receipt(ids.checkout, signal());
    expect(value).not.toHaveProperty('nextAction');
    expect(JSON.stringify(value)).not.toContain('untrusted.example');
    expect(send).toHaveBeenCalledOnce();
  });
  it('StrictMode-style stop/start creates another scope rather than recycling private state', () => {
    const controller = createContributionController('https://api.example.test');
    controller.start();
    const first = controller.getSnapshot()!;
    first.scope.queryClient.setQueryData(['private'], 'old');
    controller.stop();
    controller.start();
    const second = controller.getSnapshot()!;
    expect(first.scope.signal.aborted).toBe(true);
    expect(second.scope.id).not.toBe(first.scope.id);
    expect(second.scope.queryClient.getQueryData(['private'])).toBeUndefined();
    controller.stop();
  });
  it('keeps exact decimal strings and display progress bounded without Number money arithmetic', () => {
    expect(contributionMoney('9007199254740993', 'EUR')).toBe('90071992547409.93 EUR');
    expect(contributionMoney(null, 'USD')).toBe('Unavailable');
    const body = publicContributionFixture();
    expect(fundingPercent(body.data)).toBe(8);
    body.data.funding.eligibleGross = '9007199254740993';
    expect(fundingPercent(body.data)).toBe(100);
  });
});
describe('untrusted provider return cleanup', () => {
  it('uses a single opaque checkout hint, dropping approval token, payer, status and fragment', () => {
    expect(
      sanitizePaymentReturn(
        `https://app.example.test/payments/return?checkout=${ids.checkout}&token=private&PayerID=private&status=success#secret`,
      ),
    ).toBe('/receipts/' + ids.checkout);
  });
  it.each(['?status=success', '?checkout=bad', `?checkout=${ids.checkout}&checkout=${ids.other}`])(
    'sends missing/invalid/duplicate hints to lookup: %s',
    (query) => {
      expect(sanitizePaymentReturn('https://app.example.test/payments/return' + query)).toBe(
        '/receipts',
      );
    },
  );
  it('leaves unrelated routes untouched', () => {
    expect(sanitizePaymentReturn('https://app.example.test/contribute/' + ids.public)).toBeNull();
  });
});
