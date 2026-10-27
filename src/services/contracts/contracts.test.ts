import { describe, expect, it } from 'vitest';
import {
  SessionResponseSchema,
  parseConsumerResponse,
  consumerMoney,
  contributionAmountMinor,
} from './index';

describe('pinned browser contract compatibility', () => {
  it('parses the actual bare session contract and rejects an invented envelope', () => {
    const session = { authenticated: false, user: null, expiresAt: null, csrfToken: null };
    const read = (body: unknown) =>
      parseConsumerResponse(
        {
          status: 200,
          contentType: 'application/json; charset=utf-8',
          bodyText: JSON.stringify(body),
        },
        SessionResponseSchema,
      );
    expect(read(session)).toEqual({ kind: 'data', data: session });
    expect(read({ schemaVersion: 1, data: session })).toMatchObject({
      kind: 'error',
      action: 'protocol_error',
    });
  });

  it('keeps the existing 202 limitation explicit instead of treating pending as successful data', () => {
    expect(
      parseConsumerResponse(
        {
          status: 202,
          contentType: 'application/json',
          bodyText: JSON.stringify({
            authenticated: false,
            user: null,
            expiresAt: null,
            csrfToken: null,
          }),
        },
        SessionResponseSchema,
      ),
    ).toMatchObject({ kind: 'error', action: 'protocol_error', status: 202 });
    expect(
      parseConsumerResponse(
        { status: 204, contentType: null, bodyText: '' },
        SessionResponseSchema,
        'empty',
      ),
    ).toEqual({ kind: 'empty' });
  });

  it('uses the packaged exact-money helpers without floating conversion or hidden rounding', () => {
    expect(contributionAmountMinor('35.25', 'EUR')).toBe('3525');
    expect(consumerMoney('9007199254740993', 'EUR')).toEqual({
      currency: 'EUR',
      amountMinor: '9007199254740993',
      decimal: '90071992547409.93',
    });
    expect(() => contributionAmountMinor('1.001', 'EUR')).toThrow();
  });
});
