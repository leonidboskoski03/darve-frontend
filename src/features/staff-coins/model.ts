import { CoinMissionSchema } from '@/services/contracts/index';
import { StaffCoinError } from '@/services/staff-coins/index';
export type CoinToolSelection = {
  view: 'configuration' | 'account' | 'prices';
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
