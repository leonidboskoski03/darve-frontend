import {
  CoinReadError,
  type CoinMissionsResponse,
  type CoinLedgerResponse,
} from '@/services/coins/index';

type MissionId = CoinMissionsResponse['data']['missions'][number]['id'];
export const missionDetails: Record<
  MissionId,
  { title: string; description: string; target?: number }
> = {
  'collection.first_success': {
    title: 'First successful collection',
    description: 'Finish a collection with an eligible published suggestion.',
  },
  'funding.first_goal': {
    title: 'First funded challenge',
    description: 'Have a challenge’s funding goal recorded as reached.',
  },
  'completion.first_declaration': {
    title: 'First completion declaration',
    description: 'Make your first valid challenge completion declaration.',
  },
  'suggestions.10': {
    title: '10 qualifying suggestions',
    description: 'Build your first set of qualifying viewer ideas.',
    target: 10,
  },
  'suggestions.100': {
    title: '100 qualifying suggestions',
    description: 'Keep collecting eligible ideas from your viewers.',
    target: 100,
  },
  'suggestions.1000': {
    title: '1,000 qualifying suggestions',
    description: 'Reach the recorded suggestion milestone.',
    target: 1000,
  },
};
const numberFormat = new Intl.NumberFormat('en');
const timeFormat = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});
export function coinAmount(value: string | null, signed = false) {
  if (value === null) return 'Unconfirmed';
  if (!/^-?(0|[1-9][0-9]*)$/.test(value)) throw Error('Invalid coin amount');
  const amount = BigInt(value);
  const formatted = numberFormat.format(amount).replace(/^-/, '−');
  return signed && amount > 0n ? '+' + formatted : formatted;
}
export const coinTime = (value: string) => timeFormat.format(new Date(value));
export function coinProblem(error: unknown) {
  if (error instanceof CoinReadError) {
    if (error.failure.status === 404) return 'Coin information is unavailable on this server.';
    if (error.failure.status === 400)
      return 'This history link has expired or changed. Reload history from the start.';
    if (error.failure.status === 429)
      return 'Too many requests. Wait before refreshing coin information.';
    if (
      error.failure.status === 401 ||
      error.failure.status === 403 ||
      error.failure.category === 'authority'
    )
      return 'Your account access changed. Check your session before continuing.';
    if (error.failure.status === 503)
      return 'Coin information is temporarily unavailable. Refresh it when the service is ready.';
  }
  return 'Coin information could not be verified. Refresh it before relying on these values.';
}
/** Do not silently merge duplicate or overlapping pages into a fabricated ledger. */
export function ledgerRows(pages: CoinLedgerResponse[]) {
  const ids = new Set<string>(),
    cursors = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  const rows: CoinLedgerResponse['data']['items'] = [];
  for (const page of pages) {
    const cursor = page.data.nextCursor;
    if (cursor && cursors.has(cursor)) return null;
    if (cursor) cursors.add(cursor);
    for (const row of page.data.items) {
      if (ids.has(row.id) || row.revision >= previous) return null;
      ids.add(row.id);
      previous = row.revision;
      rows.push(row);
    }
  }
  return rows;
}
