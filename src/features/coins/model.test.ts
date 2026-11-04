import { expect, it } from 'vitest';
import { coinAmount, ledgerRows, coinTime } from './model';
import type { CoinLedgerResponse } from '@/services/coins/index';
it('keeps large exact coin values, signed changes, zero and unknown distinct', () => {
  expect(coinAmount('9223372036854775807')).toBe('9,223,372,036,854,775,807');
  expect(coinAmount('9007199254740993', true)).toBe('+9,007,199,254,740,993');
  expect(coinAmount('-5', true)).toBe('−5');
  expect(coinAmount('0')).toBe('0');
  expect(coinAmount(null)).toBe('Unconfirmed');
  expect(() => coinAmount('01')).toThrow();
});
const page = (revision: number, id: string, cursor: string | null = null): CoinLedgerResponse => ({
  schemaVersion: 1,
  serverTime: '2026-11-04T12:00:00.000Z',
  data: {
    items: [
      {
        id,
        revision,
        delta: '1',
        balance: String(revision),
        kind: 'mission',
        createdAt: '2026-11-04T12:00:00.000Z',
      },
    ],
    nextCursor: cursor,
  },
});
it('preserves ordered authoritative ledger pages without silently merging overlaps', () => {
  expect(ledgerRows([page(3, 'a', 'next'), page(2, 'b')])?.map((row) => row.revision)).toEqual([
    3, 2,
  ]);
  expect(ledgerRows([page(3, 'a', 'next'), page(2, 'a')])).toBeNull();
  expect(ledgerRows([page(3, 'a', 'next'), page(4, 'b')])).toBeNull();
  expect(ledgerRows([page(3, 'a', 'same'), page(2, 'b', 'same')])).toBeNull();
  expect(ledgerRows([])).toEqual([]);
});
it('formats recorded time explicitly in UTC', () => {
  expect(coinTime('2026-11-04T12:00:00.000Z')).toContain('12:00');
});
