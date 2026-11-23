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
});
