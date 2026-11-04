import { useMemo } from 'react';
import { useQuery, useInfiniteQuery, useIsFetching } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import { Panel } from '@/design-system/panel';
import { StatusBadge } from '@/design-system/status-badge';
import { LoadingState } from '@/design-system/loading-state';
import { ContentState } from '@/design-system/content-state';
import {
  createCoinReadClient,
  type CoinAccountResponse,
  type CoinMissionsResponse,
} from '@/services/coins/index';
import type { CreatorSession, CreatorSnapshot } from '@/services/creator-session/index';
import { coinAmount, coinTime, coinProblem, missionDetails, ledgerRows } from './model';
import './coins.css';

const accountStates = {
  synchronized: {
    label: 'Up to date',
    tone: 'success',
    description: 'Your recorded balance and available balance are shown separately.',
  },
  synchronization_pending: {
    label: 'Verification pending',
    tone: 'warning',
    description:
      'Some activity is still being verified. Available coins update after verification.',
  },
  unconfigured: {
    label: 'Rewards not configured',
    tone: 'neutral',
    description: 'Mission rewards have not been configured for this program.',
  },
  unavailable: {
    label: 'Availability unconfirmed',
    tone: 'warning',
    description: 'Coin availability cannot be confirmed right now.',
  },
} as const;
function Checked({ time }: { time: string }) {
  return (
    <p className="coins-muted coins-checked">
      Last checked <time dateTime={time}>{coinTime(time)} UTC</time>
    </p>
  );
}
function Problem({ error }: { error: unknown }) {
  return (
    <p role="alert" className="coins-problem">
      {coinProblem(error)}
    </p>
  );
}
function Balance({ value }: { value: CoinAccountResponse }) {
  const state = accountStates[value.data.state];
  return (
    <>
      <div className="coins-account-state">
        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
        <p>{state.description}</p>
      </div>
      <dl className="coins-balances">
        <div>
          <dt>Recorded balance</dt>
          <dd>
            {coinAmount(value.data.balance)} <span>coins</span>
          </dd>
        </div>
        <div>
          <dt>Available balance</dt>
          <dd>
            {coinAmount(value.data.spendableBalance)}{' '}
            {value.data.spendableBalance !== null && <span>coins</span>}
          </dd>
        </div>
      </dl>
      {!value.data.redemptionAllowed && (
        <p className="coins-muted">
          New template redemptions are currently unavailable for this account.
        </p>
      )}
      <Checked time={value.serverTime} />
    </>
  );
}
function Missions({ value }: { value: CoinMissionsResponse }) {
  return (
    <>
      <p className="coins-muted">
        {value.data.progress.toLocaleString('en')} of {value.data.progressCap.toLocaleString('en')}{' '}
        qualifying suggestions recorded. Repeated messages for the same idea from the same viewer in
        one round count once.
      </p>
      <ul className="coins-missions">
        {(Object.keys(missionDetails) as (keyof typeof missionDetails)[]).map((id) => {
          const mission = value.data.missions.find((item) => item.id === id)!;
          const detail = missionDetails[id];
          return (
            <li key={id} className="coins-mission">
              <div>
                <h3>{detail.title}</h3>
                <p className="coins-muted">{detail.description}</p>
                {detail.target !== undefined && (
                  <div className="coins-progress">
                    <progress
                      aria-label={detail.title + ' progress'}
                      max={detail.target}
                      value={Math.min(value.data.progress, detail.target)}
                    />
                    <span>
                      {Math.min(value.data.progress, detail.target).toLocaleString('en')} /{' '}
                      {detail.target.toLocaleString('en')}
                    </span>
                  </div>
                )}
                {mission.completedAt && (
                  <p className="coins-muted">
                    <time dateTime={mission.completedAt}>{coinTime(mission.completedAt)} UTC</time>
                  </p>
                )}
              </div>
              <div className="coins-mission-result">
                <StatusBadge tone={mission.completed ? 'success' : 'neutral'}>
                  {mission.completed ? 'Completed' : 'Not completed'}
                </StatusBadge>
                <p>
                  {mission.completed ? 'Recorded reward: ' : 'Current reward: '}
                  {mission.completed
                    ? coinAmount(mission.earned)
                    : mission.currentReward === null
                      ? 'Not configured'
                      : coinAmount(mission.currentReward)}
                  {(mission.completed || mission.currentReward !== null) && ' coins'}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <Checked time={value.serverTime} />
    </>
  );
}
const activityNames = {
  mission: 'Mission reward',
  adjustment: 'Staff adjustment',
  redemption: 'Template redemption',
};
export function Coins({
  session,
  snapshot,
}: {
  session: CreatorSession;
  snapshot: CreatorSnapshot;
}) {
  const client = useMemo(() => createCoinReadClient(session), [session]);
  const prefix = snapshot.scope.key(['coins']);
  const account = useQuery({
    queryKey: snapshot.scope.key(['coins', 'account']),
    queryFn: ({ signal }) => client.account(signal),
    retry: false,
  });
  const missions = useQuery({
    queryKey: snapshot.scope.key(['coins', 'missions']),
    queryFn: ({ signal }) => client.missions(signal),
    retry: false,
  });
  const historyKey = snapshot.scope.key(['coins', 'ledger']);
  const history = useInfiniteQuery({
    queryKey: historyKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      client.ledger(pageParam ? { cursor: pageParam } : {}, signal),
    getNextPageParam: (page) => page.data.nextCursor,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const fetching = useIsFetching({ queryKey: prefix }) > 0;
  const rows = ledgerRows(history.data?.pages ?? []);
  const reloadHistory = () => {
    void snapshot.scope.queryClient.resetQueries({ queryKey: historyKey, exact: true });
  };
  return (
    <div className="coins-page">
      <header className="coins-heading">
        <div>
          <h1>Coins</h1>
          <p>Rewards from your stream, recorded in one place.</p>
        </div>
        <Button
          tone="secondary"
          disabled={fetching}
          onClick={() => {
            void snapshot.scope.queryClient.resetQueries({ queryKey: prefix });
          }}
        >
          {fetching ? 'Refreshing coins…' : 'Refresh coins'}
        </Button>
      </header>
      <Panel
        title="Your balance"
        description="Coins have no cash value. They cannot be purchased or transferred."
      >
        {account.isPending ? (
          <LoadingState label="Loading coin balance…" />
        ) : account.isError ? (
          <Problem error={account.error} />
        ) : (
          <Balance value={account.data} />
        )}
      </Panel>
      <Panel
        title="Missions"
        description="One-time rewards are recorded automatically after qualifying activity. New reward settings apply to future activity."
      >
        {missions.isPending ? (
          <LoadingState label="Loading coin missions…" />
        ) : missions.isError ? (
          <Problem error={missions.error} />
        ) : (
          <Missions value={missions.data} />
        )}
      </Panel>
      <Panel
        title="Coin history"
        description="Most recent first. Each balance is the recorded balance after that transaction."
      >
        {history.isPending ? (
          <LoadingState label="Loading coin history…" />
        ) : rows === null ? (
          <Problem error={null} />
        ) : history.isError ? (
          <Problem error={history.error} />
        ) : rows.length === 0 ? (
          <ContentState kind="empty" title="No coin activity yet">
            <p>
              Qualifying mission rewards and any later adjustments will appear here after they are
              recorded.
            </p>
          </ContentState>
        ) : (
          <div
            className="coins-table-scroll"
            role="region"
            aria-label="Coin history table"
            tabIndex={0}
          >
            <table className="coins-table">
              <caption>Recorded coin activity · times in UTC</caption>
              <thead>
                <tr>
                  <th scope="col">Recorded</th>
                  <th scope="col">Activity</th>
                  <th scope="col">Change</th>
                  <th scope="col">Balance after</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <time dateTime={row.createdAt}>{coinTime(row.createdAt)}</time>
                    </td>
                    <td>{activityNames[row.kind]}</td>
                    <td className="coins-number">{coinAmount(row.delta, true)}</td>
                    <td className="coins-number">{coinAmount(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="coins-history-actions">
          <Button tone="secondary" onClick={reloadHistory} disabled={history.isFetching}>
            Reload history
          </Button>
          {history.hasNextPage && rows !== null && !history.isError && (
            <Button
              tone="secondary"
              disabled={history.isFetching || history.isError}
              onClick={() => {
                void history.fetchNextPage();
              }}
            >
              {history.isFetchingNextPage ? 'Loading more history…' : 'Load more history'}
            </Button>
          )}
        </div>
        {history.data?.pages[0] && <Checked time={history.data.pages[0].serverTime} />}
      </Panel>
    </div>
  );
}
