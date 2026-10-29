import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import {
  createReportingClient,
  moneyText,
  reportTime,
  fundingLabel,
  performanceLabel,
} from '@/services/reporting/index';
import type { CreatorSession, CreatorSnapshot } from '@/services/creator-session/index';
import { ReportProblem } from './common';
import './reporting.css';
export type HistoryFilter = 'all' | 'funding' | 'funded' | 'declared' | 'unsuccessful';
export function History({
  session,
  snapshot,
  current,
  filter,
  onFilters,
}: {
  session: CreatorSession;
  snapshot: CreatorSnapshot;
  current: boolean;
  filter: HistoryFilter;
  onFilters: (current: boolean, filter: HistoryFilter) => void;
}) {
  const client = useMemo(() => createReportingClient(session), [session]);
  const query = useInfiniteQuery({
    queryKey: snapshot.scope.key(['challenge-history', current]),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => client.history(current, pageParam, signal),
    getNextPageParam: (page) => page.data.nextCursor,
    retry: false,
  });
  const items = [
    ...new Map(
      (query.data?.pages ?? []).flatMap((page) => page.data.items).map((item) => [item.id, item]),
    ).values(),
  ];
  const shown = items.filter(
    (item) =>
      filter === 'all' ||
      (filter === 'declared'
        ? item.performance.state === 'declared_complete'
        : filter === 'funded'
          ? item.funding.state === 'funded'
          : filter === 'funding'
            ? item.funding.state === 'pending'
            : item.funding.state === 'unsuccessful'),
  );
  const refresh = () =>
    snapshot.scope.queryClient.resetQueries({
      queryKey: snapshot.scope.key(['challenge-history', current]),
      exact: true,
    });
  return (
    <>
      <header className="report-heading">
        <span>Your stream · Your records</span>
        <h1>Challenge history</h1>
        <p>
          All retained accepted challenges stay here, including overlapping rounds and closed
          funding windows.
        </p>
      </header>
      <div className="report-actions">
        <Button
          tone={!current ? 'primary' : 'secondary'}
          aria-pressed={!current}
          onClick={() => onFilters(false, filter)}
        >
          All retained history
        </Button>
        <Button
          tone={current ? 'primary' : 'secondary'}
          aria-pressed={current}
          onClick={() => onFilters(true, filter)}
        >
          Open funding windows
        </Button>
        <Button
          tone="secondary"
          busy={query.isFetching}
          onClick={() => {
            void refresh();
          }}
        >
          Refresh history
        </Button>
      </div>
      <label className="ds-field report-filter">
        <span className="ds-field__label">Filter loaded challenges</span>
        <select
          className="ds-input"
          value={filter}
          onChange={(event) => onFilters(current, event.target.value as HistoryFilter)}
        >
          <option value="all">All statuses</option>
          <option value="funding">Awaiting funding</option>
          <option value="funded">Goal recognized</option>
          <option value="declared">Streamer declared complete</option>
          <option value="unsuccessful">Funding unsuccessful</option>
        </select>
      </label>
      <ReportProblem error={query.error} />
      {query.isPending ? (
        <p role="status">Loading challenge history…</p>
      ) : query.isError ? null : (
        <>
          <p className="report-muted">
            Page snapshots read from {reportTime(query.data.pages[0]!.serverTime)} to{' '}
            {reportTime(query.data.pages.at(-1)!.serverTime)} UTC. Refresh for current status.
          </p>
          <p className="report-muted">
            {items.length} retained challenges loaded; {shown.length} match this filter.{' '}
            {query.hasNextPage
              ? 'More pages are available.'
              : 'No further page was returned. Refresh for newly created records.'}{' '}
            Open funding windows uses the server's effective deadline; it is separate from
            performance status.
          </p>
          <div className="report-history">
            {shown.length === 0 ? (
              <section className="report-panel">
                <h2>No matching challenges</h2>
                <p>
                  {items.length === 0
                    ? 'No retained accepted challenges were returned in this scope.'
                    : 'Change the filter or load more pages to inspect other challenges.'}
                </p>
                <a href="/collection">Start a collection</a>
              </section>
            ) : (
              shown.map((item) => (
                <article className="report-panel" key={item.id}>
                  <span className="report-eyebrow">
                    {item.stream.provider} · {fundingLabel(item.funding.state)}
                  </span>
                  <h2>
                    <a href={'/challenges/' + item.id}>
                      {item.contentAvailability === 'available'
                        ? item.terms.text
                        : 'Challenge content unavailable'}
                    </a>
                  </h2>
                  <p>
                    {moneyText(item.terms.goal.amountMinor, item.terms.goal.currency)} goal ·{' '}
                    {performanceLabel(item.performance.state)}
                  </p>
                  <p className="report-muted">
                    Accepted {reportTime(item.acceptedAt)} UTC · Funding closes{' '}
                    {reportTime(
                      item.fundingWindow?.effectiveClosesAt ?? item.terms.fundingClosesAt,
                    )}{' '}
                    UTC
                  </p>
                  <div className="report-actions">
                    <a href={'/challenges/' + item.id}>View challenge</a>
                    <a href={'/collection/' + item.roundId + '/analytics'}>Round analytics</a>
                    <a href={'/collection/' + item.roundId + '/suggestions'}>Review round ideas</a>
                  </div>
                </article>
              ))
            )}
          </div>
          {query.hasNextPage && (
            <Button
              tone="secondary"
              busy={query.isFetchingNextPage}
              onClick={() => {
                void query.fetchNextPage();
              }}
            >
              Load more challenges
            </Button>
          )}
        </>
      )}
    </>
  );
}
