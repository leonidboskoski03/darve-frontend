const numbers = new Intl.NumberFormat('en');
export { creatorTime as coinTime } from '@/shared/creator-time';
export function coinAmount(value: string | null, signed = false) {
  if (value === null) return 'Unconfirmed';
  if (!/^-?(0|[1-9][0-9]*)$/.test(value)) throw Error('Invalid coin amount');
  const amount = BigInt(value),
    formatted = numbers.format(amount).replace(/^-/, '−');
  return signed && amount > 0n ? '+' + formatted : formatted;
}
