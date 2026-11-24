import { CoinMissionSchema } from '@/services/contracts/index';
import { StaffCoinError, type StaffFeeAgreements } from '@/services/staff-coins/index';
export type CoinToolSelection = {
  view: 'configuration' | 'account' | 'prices' | 'fees' | 'bots';
  owner: string;
  template: string;
};
export const missions = CoinMissionSchema.options;
export const missionNames: Record<(typeof missions)[number], string> = {
  'collection.first_success': 'First successful collection',
  'funding.first_goal': 'First funded goal',
  'completion.first_declaration': 'First completion declaration',
  'suggestions.10': '10 qualifying suggestions',
  'suggestions.100': '100 qualifying suggestions',
  'suggestions.1000': '1000 qualifying suggestions',
};
export function staffCoinMessage(error: unknown) {
  if (!(error instanceof StaffCoinError))
    return 'Coin information could not be verified. Refresh before reviewing a change.';
  const code = error.problem.code;
  if (code === 'REAUTHENTICATION_REQUIRED')
    return 'Verify your staff identity again, then read current information and review a new change.';
  if (code === 'CURSOR_EXPIRED' || code === 'STALE_CURSOR')
    return 'This history cursor expired. Reload the first page.';
  if (['STALE_VERSION', 'CONFLICT'].includes(code))
    return 'The reviewed version or balance is no longer current. Refresh and review a new change.';
  if (error.problem.status === 403)
    return 'Current staff access does not allow this information or change.';
  if (error.problem.status === 404) return 'This record is unavailable with your current access.';
  if (error.problem.status === 429)
    return 'Requests are temporarily limited. Wait before refreshing or retrying the held request.';
  return 'Coin information could not be verified. Refresh before reviewing a change.';
}

type FeePolicy = StaffFeeAgreements['items'][number]['policy'];
/** Minor units as a decimal string, e.g. 1000000 -> 10,000.00. */
export function minorText(value: string) {
  const padded = value.padStart(3, '0');
  return BigInt(padded.slice(0, -2)).toLocaleString('en-US') + '.' + padded.slice(-2);
}
/** Decimal text to minor units (two decimals), or null when invalid. */
export function decimalToMinor(value: string) {
  const match = /^(\d{1,16})(?:\.(\d{1,2}))?$/.exec(value.trim().replaceAll(',', ''));
  if (!match) return null;
  const minor = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  return minor > 0n ? minor.toString() : null;
}
/** Percent text (two decimals) to basis points 0–9999, or null. */
export function percentToBasisPoints(value: string) {
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
}
export function feeText(fee: FeePolicy['currencies'][string]['darveFee'], currency: string) {
  if (fee.type === 'none') return 'No Darve fee';
  const percent = 'basisPoints' in fee ? (fee.basisPoints / 100).toString() + '%' : '';
  if (fee.type === 'percentage') return percent;
  if (fee.type === 'flat') return minorText(fee.amountMinor) + ' ' + currency + ' per payment';
  return percent + ' + ' + minorText(fee.amountMinor) + ' ' + currency + ' per payment';
}
