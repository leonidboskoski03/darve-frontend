import { describe, expect, it } from 'vitest';
import { failure } from '@/services/api/index';
import { ReceivingError } from '@/services/receiving/index';
import { receivingMessage } from './model';

describe('receiving error copy', () => {
  it('prioritizes HTTP rate limiting over provider setup and conflict errors', () => {
    const limited = new ReceivingError(failure('http', 'CONFLICT', 429));
    expect(receivingMessage(limited, true)).toBe('Too many attempts — wait a minute.');
    expect(receivingMessage(limited)).toBe('Too many attempts — wait a minute.');
  });
  it('explains a PayPal account that already receives for another Darve account', () => {
    const owned = new ReceivingError(failure('http', 'ACCOUNT_IN_USE', 409));
    expect(receivingMessage(owned, true)).toBe(
      'This PayPal account already receives payments for another Darve account. Use Start over PayPal and connect a different PayPal account.',
    );
  });
});
