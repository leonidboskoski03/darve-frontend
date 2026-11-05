import { useState, type ReactNode } from 'react';
import { Button } from '@/design-system/button';
import { Panel } from '@/design-system/panel';
import { StatusBadge } from '@/design-system/status-badge';
import type { CreatorSession, CreatorSnapshot } from '@/services/creator-session/index';
import {
  createReportingClient,
  fundingLabel,
  moneyText,
  performanceLabel,
  reportTime,
} from '@/services/reporting/index';
import { useChallengePages } from './challenge-pages';
import './reporting.css';

function CurrentChallenges({
  session,
  scope,
}: {
  session: CreatorSession;
  scope: CreatorSnapshot['scope'];
}) {
  const [client] = useState(() => createReportingClient(session));
  const query = useChallengePages(client, scope, true);
  const items = new Map(
    query.data?.pages.flatMap(({ data, serverTime }) =>
      data.items.map((challenge) => [challenge.id, { challenge, serverTime }] as const),
    ),
  );
  return (
    <Panel title="Current funding windows">
      <p className="report-muted">
        Open at the last server check. Each challenge has its own deadline and funding status.
        Closed windows stay in challenge history.
      </p>
      {query.isError ? (
        <p role="status">Current funding windows are unavailable.</p>
      ) : query.isPending || query.isRefetching ? (
        <p role="status">Checking current funding windows…</p>
      ) : items.size === 0 ? (
        <p>No open funding windows were returned.</p>
      ) : (
        <ul className="dashboard-challenges">
          {[...items.values()].map(({ challenge, serverTime }) => {
            const deadline =
              challenge.fundingWindow?.effectiveClosesAt ?? challenge.terms.fundingClosesAt;
            return (
              <li key={challenge.id}>
                <h3>
                  <a href={'/challenges/' + challenge.id}>
                    {challenge.contentAvailability === 'available'
                      ? (challenge.terms.text ?? 'View challenge')
                      : 'Challenge content unavailable'}
                  </a>
                </h3>
                <p>
                  <StatusBadge>{fundingLabel(challenge.funding.state)}</StatusBadge>{' '}
                  {performanceLabel(challenge.performance.state)}
                </p>
                <p>
                  {moneyText(challenge.funding.eligibleGross, challenge.terms.goal.currency)}{' '}
                  eligible ·{' '}
                  {moneyText(challenge.terms.goal.amountMinor, challenge.terms.goal.currency)} goal
                </p>
                {!challenge.funding.checkoutAvailability.available ? (
                  <p>Checkout unavailable at last check.</p>
                ) : null}
                <p className="report-muted">
                  Funding deadline <time dateTime={deadline}>{reportTime(deadline)} UTC</time> ·
                  Checked <time dateTime={serverTime}>{reportTime(serverTime)} UTC</time>
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <div className="report-actions">
        <Button
          tone="quiet"
          busy={query.isRefetching}
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void scope.queryClient.resetQueries({
              queryKey: scope.key(['challenge-history', true]),
              exact: true,
            });
          }}
        >
          Check funding windows
        </Button>
        {query.hasNextPage && !query.isError ? (
          <Button
            tone="secondary"
            busy={query.isFetchingNextPage}
            disabled={query.isRefetching}
            onClick={() => {
              void query.fetchNextPage();
            }}
          >
            Load more funding windows
          </Button>
        ) : null}
        <a href="/challenges">View challenge history</a>
      </div>
    </Panel>
  );
}

export function DashboardHome({
  session,
  scope,
  collection,
  obs,
  connections,
  receiving,
}: {
  session: CreatorSession;
  scope: CreatorSnapshot['scope'];
  collection: ReactNode;
  obs: ReactNode;
  connections: ReactNode;
  receiving: ReactNode;
}) {
  return (
    <>
      <header className="report-heading">
        <span>Your stream · Creator workspace</span>
        <h1>Dashboard</h1>
        <p>
          Manage your collection, follow accepted challenges, and check the services you use on
          stream.
        </p>
      </header>
      <div className="dashboard-workspace">
        <div className="dashboard-workspace__stream">
          {collection}
          <CurrentChallenges session={session} scope={scope} />
        </div>
        <div className="dashboard-workspace__setup">
          {obs}
          <Panel title="Stream setup">
            <h3>Streaming connections</h3>
            {connections}
            <p>
              <a href="/integrations">Manage connections</a>
            </p>
            <h3>Receiving in the test environment</h3>
            {receiving}
            <p>
              <a href="/account/payments">Open payout settings</a>
            </p>
            <nav className="dashboard-workspace__links" aria-label="Creator setup shortcuts">
              <a href="/onboarding">Setup guide</a>
              <a href="/account">Account settings</a>
              <a href="/support">Creator support</a>
            </nav>
          </Panel>
        </div>
      </div>
    </>
  );
}
