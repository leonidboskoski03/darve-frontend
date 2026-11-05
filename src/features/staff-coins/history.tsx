import { Button } from '@/design-system/button';
import { coinAmount } from '@/services/coins/index';
import { StaffCoinError } from '@/services/staff-coins/index';
import { missions, missionNames, staffCoinMessage } from './model';
type HistoryRow = {
  revision: number;
  createdAt: string;
  amount?: string;
  delta?: string;
  balance?: string;
  active?: boolean;
  kind?: string;
  rewards?: Record<string, string>;
};
export function History({
  items,
  next,
  first,
  advance,
  disabled,
}: {
  items: HistoryRow[];
  next: string | null;
  first: () => void;
  advance: (cursor: string) => void;
  disabled: boolean;
}) {
  return (
    <section aria-labelledby="coin-history-title">
      <h2 id="coin-history-title">Recorded history</h2>
      <ol className="staff-coins-history">
        {items.map((row) => (
          <li key={row.revision}>
            <strong>Revision {row.revision}</strong> ·{' '}
            <time dateTime={row.createdAt}>{row.createdAt}</time>
            {row.amount !== undefined ? <p>Price: {coinAmount(row.amount)} coins</p> : null}
            {row.delta !== undefined ? (
              <p>
                {row.kind}: {row.delta} coins · Balance: {coinAmount(row.balance!)} coins
              </p>
            ) : null}
            {row.active !== undefined ? (
              <p>Future earning {row.active ? 'enabled' : 'disabled'}</p>
            ) : null}
            {row.rewards ? (
              <dl>
                {missions.map((id) => (
                  <div key={id}>
                    <dt>{missionNames[id]}</dt>
                    <dd>{coinAmount(row.rewards![id]!)} coins</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        ))}
      </ol>
      {!items.length ? <p>No recorded changes on this page.</p> : null}
      <div className="staff-coins-actions">
        <Button tone="quiet" disabled={disabled} onClick={first}>
          Reload first history page
        </Button>
        <Button
          tone="secondary"
          disabled={disabled || !next}
          onClick={() => {
            if (next) advance(next);
          }}
        >
          Next history page
        </Button>
      </div>
    </section>
  );
}
export function ReadFailure({
  error,
  first,
  refresh,
  historyCursor,
}: {
  error: unknown;
  first: () => void;
  refresh: () => void;
  historyCursor: boolean;
}) {
  return (
    <section>
      <p role="alert">
        {historyCursor &&
        error instanceof StaffCoinError &&
        error.problem.status === 400 &&
        error.problem.code === 'INVALID_INPUT'
          ? 'This history page cannot be verified. Its cursor may have expired. Reload the first page.'
          : staffCoinMessage(error)}
      </p>
      <div className="staff-coins-actions">
        <Button tone="secondary" onClick={refresh}>
          Retry coin read
        </Button>
        <Button tone="quiet" onClick={first}>
          Reload first history page
        </Button>
      </div>
    </section>
  );
}
