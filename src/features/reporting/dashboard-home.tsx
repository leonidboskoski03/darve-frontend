import { useState, type ReactNode } from 'react';
import { Clock3 } from 'lucide-react';
import { Button } from '@/design-system/button';
import { Panel } from '@/design-system/panel';
import { Disclosure } from '@/design-system/disclosure';
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
        <div className="dashboard-challenges-empty">
          <Clock3 size={26} aria-hidden="true" />
          <p>No open funding windows were returned.</p>
          <span>Start a collection to receive viewer ideas.</span>
        </div>
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
    <div className="dashboard-home">
      <header className="report-heading">
        <h1>Dashboard</h1>
      </header>
      <section className="dashboard-receiving" aria-label="Contribution setup">
        <div>
          <strong>Viewer contributions</strong>
          <p>Manage receiving accounts for your challenges.</p>
        </div>
        {receiving}
        <a href="/account/payments">Payout settings</a>
      </section>
      <div className="dashboard-workspace">
        <div className="dashboard-workspace__stream">
          <header className="dashboard-section-heading">
            <h2>Start collection</h2>
            <p>Choose a live stream and collect challenge ideas from chat.</p>
          </header>
          {collection}
        </div>
        <div className="dashboard-workspace__setup">
          <header className="dashboard-section-heading">
            <h2>Overlay (OBS / Streamlabs)</h2>
            <p>Add Darve as a Browser Source before going live.</p>
          </header>
          {obs}
        </div>
      </div>
      <section className="dashboard-challenge-section" aria-label="Challenges">
        <header className="dashboard-section-heading dashboard-section-heading--row">
          <h2>Challenges</h2>
          <a href="/challenges">Challenge history</a>
        </header>
        <CurrentChallenges session={session} scope={scope} />
      </section>
      <Disclosure label="Streaming connections and setup">
        {connections}
        <nav className="dashboard-workspace__links" aria-label="Creator setup shortcuts">
          <a href="/integrations">Manage connections</a>
          <a href="/onboarding">Setup guide</a>
          <a href="/account">Account settings</a>
          <a href="/support">Creator support</a>
        </nav>
      </Disclosure>
    </div>
  );
}
