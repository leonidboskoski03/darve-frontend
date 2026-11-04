const numbers = new Intl.NumberFormat('en');
const times = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});
export function coinAmount(value: string | null, signed = false) {
  if (value === null) return 'Unconfirmed';
  if (!/^-?(0|[1-9][0-9]*)$/.test(value)) throw Error('Invalid coin amount');
  const amount = BigInt(value),
    formatted = numbers.format(amount).replace(/^-/, '−');
  return signed && amount > 0n ? '+' + formatted : formatted;
}
export const coinTime = (value: string) => times.format(new Date(value));
