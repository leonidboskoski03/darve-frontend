import { describe, expect, it, vi } from 'vitest';
import { createJsonClient } from '@/services/api/index';
import { checkoutConsumerView } from '@/services/contracts/index';
import { createCheckoutCommands, checkoutUncertain } from './checkout';
import { sanitizePaymentReturn } from './navigation';
import {
  contributionIds as ids,
  privateReceiptFixture,
  publicContributionFixture,
} from './fixture.test-helper';

const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function wire(provider: 'stripe' | 'paypal' = 'stripe') {
  const value = privateReceiptFixture(provider);
  value.data.amount.amountMinor = '1000';
  return value;
}
function receipt(provider: 'stripe' | 'paypal' = 'stripe') {
  const value = wire(provider);
  const { nextAction, ...rest } = checkoutConsumerView(value, {
    publicChallengeId: ids.public,
    termsVersion: ids.terms,
    paymentProvider: provider,
  });
  void nextAction;
  return { ...rest, createdAt: value.data.createdAt };
}
function setup(send = vi.fn<typeof fetch>()) {
  let revision = 0;
  const navigate = vi.fn();
  const commands = createCheckoutCommands({
    request: createJsonClient({
      origin: 'https://api.example.test',
      audience: 'guest',
      fetcher: send,
    }),
    active: () => {},
    revision: () => revision,
    navigate,
  });
  return { commands, send, navigate, change: () => revision++ };
}

describe('explicit guest checkout commands', () => {
  it('requires server availability and exact decimal input before transport', () => {
    const f = setup();
    expect(() => f.commands.prepare(publicContributionFixture().data, 'stripe', '10.00')).toThrow();
    for (const amount of ['1e2', '0', '-1', '10.001', 'NaN'])
      expect(() =>
        f.commands.prepare(publicContributionFixture(true).data, 'stripe', amount),
      ).toThrow();
    expect(f.send).not.toHaveBeenCalled();
  });
  it('retains one immutable amount/body/key across cookie initialization and deliberate replay', async () => {
    const f = setup(
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          response(
            {
              schemaVersion: 1,
              serverTime: '2026-11-02T12:00:00.000Z',
              error: {
                code: 'GUEST_PROOF_REQUIRED',
                message: 'private',
                requestId: 'synthetic-request',
                retryAfterSeconds: null,
                retryable: true,
                issues: [],
                refetch: null,
              },
            },
            409,
          ),
        )
        .mockResolvedValueOnce(response(wire(), 201)),
    );
    const attempt = f.commands.prepare(publicContributionFixture(true).data, 'stripe', '10.00');
    expect(Object.isFrozen(attempt.body)).toBe(true);
    await expect(f.commands.create(attempt)).rejects.toMatchObject({
      problem: { code: 'GUEST_PROOF_REQUIRED' },
    });
    const value = await f.commands.create(attempt);
    expect(value.id).toBe(ids.checkout);
    expect(value).not.toHaveProperty('nextAction');
    expect(f.send.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify(attempt.body),
      JSON.stringify(attempt.body),
    ]);
    expect(
      f.send.mock.calls.map(([, init]) => new Headers(init?.headers).get('Idempotency-Key')),
    ).toEqual([attempt.key, attempt.key]);
    expect(f.send.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include', method: 'POST' });
    expect(f.navigate).not.toHaveBeenCalled();
  });
  it('rejects fabricated attempts and mismatched server acknowledgement', async () => {
    const value = wire();
    value.data.publicChallengeId = ids.other;
    const f = setup(vi.fn<typeof fetch>().mockResolvedValue(response(value, 201)));
    const attempt = f.commands.prepare(publicContributionFixture(true).data, 'stripe', '10.00');
    await expect(f.commands.create({ ...attempt })).rejects.toThrow();
    expect(f.send).not.toHaveBeenCalled();
    await expect(f.commands.create(attempt)).rejects.toMatchObject({
      problem: { code: 'CHECKOUT_CONTEXT_MISMATCH' },
    });
  });
  it('never retries automatically after an unknown transport result', async () => {
    const f = setup(vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network detail')));
    const attempt = f.commands.prepare(publicContributionFixture(true).data, 'stripe', '10.00');
    const error = await f.commands.create(attempt).catch((value: unknown) => value);
    expect(checkoutUncertain(error)).toBe(true);
    expect(f.send).toHaveBeenCalledOnce();
  });
  it('fences overlapping commands and late results after browser authority recheck', async () => {
    let settle!: (value: Response) => void;
    const f = setup(
      vi.fn<typeof fetch>().mockImplementation(
        () =>
          new Promise((resolve) => {
            settle = resolve;
          }),
      ),
    );
    const attempt = f.commands.prepare(publicContributionFixture(true).data, 'stripe', '10.00');
    const first = f.commands.create(attempt);
    await expect(f.commands.create(attempt)).rejects.toMatchObject({
      problem: { code: 'COMMAND_IN_PROGRESS' },
    });
    f.change();
    settle(response(wire(), 201));
    const late = await first.catch((error: unknown) => error);
    expect(late).toMatchObject({ problem: { category: 'authority' } });
    expect(checkoutUncertain(late)).toBe(true);
    expect(f.send).toHaveBeenCalledOnce();
  });
  it('freezes the reviewed funding-window revision even if a later public snapshot changes', () => {
    const f = setup(),
      value = publicContributionFixture(true).data;
    value.fundingWindow = {
      version: 1,
      revision: 2,
      policyVersion: 'support-extension-v1',
      disclosure: 'Synthetic extension disclosure',
      originalClosesAt: value.terms.fundingClosesAt,
      effectiveClosesAt: '2026-11-02T12:11:00.000Z',
      cumulativeSeconds: 60,
    };
    const attempt = f.commands.prepare(value, 'stripe', '10.00');
    value.fundingWindow.revision = 3;
    expect(attempt.body.fundingWindow?.revision).toBe(2);
    expect(Object.isFrozen(attempt.body.fundingWindow)).toBe(true);
  });
  it.each(['stripe', 'paypal'] as const)(
    'resumes only the same %s object and keeps its destination transient and single use',
    async (provider) => {
      const value = wire(provider);
      value.data.nextAction =
        provider === 'stripe'
          ? {
              type: 'redirect',
              url: 'https://checkout.stripe.com/c/pay/cs_test_SYNTHETIC#synthetic-provider-configuration',
            }
          : {
              type: 'paypal_approval',
              orderId: 'SYNTHETICORDER',
              url: 'https://www.sandbox.paypal.com/checkoutnow?token=SYNTHETICORDER',
            };
      const f = setup(vi.fn<typeof fetch>().mockResolvedValue(response(value)));
      const result = await f.commands.resume(receipt(provider));
      expect(result.available).toBe(true);
      expect(JSON.stringify(result)).not.toContain('https:');
      expect(f.send.mock.calls[0]?.[0]).toContain('/api/checkouts/' + ids.checkout + '/resume');
      expect(new Headers(f.send.mock.calls[0]?.[1]?.headers).get('Idempotency-Key')).toBeNull();
      expect(() => f.commands.follow({ ...result })).toThrow();
      f.commands.follow(result);
      expect(f.navigate).toHaveBeenCalledOnce();
      expect(() => f.commands.follow(result)).toThrow();
    },
  );
  it.each([
    'https://evil.test/c/pay/cs_test_a',
    'http://checkout.stripe.com/c/pay/cs_test_a',
    'https://user@checkout.stripe.com/c/pay/cs_test_a',
  ])('rejects unsafe provider continuation %s', async (url) => {
    const value = wire();
    value.data.nextAction = { type: 'redirect', url };
    const f = setup(vi.fn<typeof fetch>().mockResolvedValue(response(value)));
    await expect(f.commands.resume(receipt())).rejects.toThrow();
    expect(f.navigate).not.toHaveBeenCalled();
  });
  it('rejects a mismatched PayPal approval token and a pending response carrying navigation', async () => {
    const value = wire('paypal');
    value.data.nextAction = {
      type: 'paypal_approval',
      orderId: 'ORIGINAL',
      url: 'https://www.sandbox.paypal.com/checkoutnow?token=OTHER',
    };
    const f = setup(
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response(value))
        .mockResolvedValueOnce(response(value, 202)),
    );
    await expect(f.commands.resume(receipt('paypal'))).rejects.toThrow();
    await expect(f.commands.resume(receipt('paypal'))).rejects.toThrow();
    expect(f.navigate).not.toHaveBeenCalled();
  });
  it('rejects PayPal fragments while retaining the exact order-token binding', async () => {
    const value = wire('paypal');
    value.data.nextAction = {
      type: 'paypal_approval',
      orderId: 'ORIGINAL',
      url: 'https://www.sandbox.paypal.com/checkoutnow?token=ORIGINAL#unexpected',
    };
    const f = setup(vi.fn<typeof fetch>().mockResolvedValue(response(value)));
    await expect(f.commands.resume(receipt('paypal'))).rejects.toThrow();
    expect(f.navigate).not.toHaveBeenCalled();
  });
  it('requires a PayPal awaiting receipt and retains the same capture key/body after uncertainty', async () => {
    const f = setup(
      vi
        .fn<typeof fetch>()
        .mockRejectedValueOnce(new TypeError('lost acknowledgement'))
        .mockResolvedValueOnce(response(wire('paypal'), 202)),
    );
    expect(() => f.commands.prepareCapture(receipt())).toThrow();
    const attempt = f.commands.prepareCapture(receipt('paypal'));
    await expect(f.commands.capture(attempt)).rejects.toThrow();
    await expect(f.commands.capture(attempt)).resolves.toMatchObject({
      paymentStatus: 'unconfirmed',
    });
    expect(f.send.mock.calls.map(([, init]) => init?.body)).toEqual(['{}', '{}']);
    expect(
      f.send.mock.calls.map(([, init]) => new Headers(init?.headers).get('Idempotency-Key')),
    ).toEqual([attempt.key, attempt.key]);
  });
  it('cleans cancellation hints without granting success or receipt access', () => {
    expect(
      sanitizePaymentReturn(
        'https://app.example.test/payments/cancel?checkout=' +
          ids.checkout +
          '&token=private#success',
      ),
    ).toBe('/receipts/' + ids.checkout);
  });
});
