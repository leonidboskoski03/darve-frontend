import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import { createReportingClient, type AnalyticsRead } from '@/services/reporting/index';
import type { CreatorSession, CreatorSnapshot } from '@/services/creator-session/index';
import { AsOf, ReportProblem, CurrencyRows } from './common';
import './reporting.css';
const metrics = [
  ['observedChatMessages', 'Observed chat messages'],
  ['eligibleSubmissions', 'Eligible submissions'],
  ['uniqueSubmitters', 'Unique submitters'],
  ['safeSuggestionCount', 'Safe suggestions'],
  ['pendingObservationCount', 'Pending observations'],
] as const;
function Metric({ value }: { value: AnalyticsRead['data']['observedChatMessages'] }) {
  return (
    <>
      {value.availability === 'unavailable' ? 'Unavailable' : value.value?.toLocaleString('en')}
      {value.availability === 'partial' ? ' · Partial' : ''}
    </>
  );
}
export function RoundAnalytics({
  session,
  snapshot,
  roundId,
}: {
  session: CreatorSession;
  snapshot: CreatorSnapshot;
  roundId: string;
}) {
  const client = useMemo(() => createReportingClient(session), [session]);
  const query = useQuery({
    queryKey: snapshot.scope.key(['round-analytics', roundId]),
    queryFn: ({ signal }) => client.analytics(roundId, signal),
    retry: false,
  });
  const value = !query.isError ? query.data?.data : undefined;
  return (
    <>
      <header className="report-heading">
        <span>Your stream · Your records</span>
        <h1>Round analytics</h1>
        <p>
          Collection counts use server receipt time. Financial rows describe the accepted
          challenge's lifetime.
        </p>
      </header>
      <div className="report-actions">
        <a href={'/collection/' + encodeURIComponent(roundId)}>Collection status</a>
        <a href={'/collection/' + encodeURIComponent(roundId) + '/suggestions'}>Review ideas</a>
        <Button
          tone="secondary"
          busy={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          Refresh round analytics
        </Button>
      </div>
      <ReportProblem error={query.error} />
      {query.isPending && <p role="status">Loading round analytics…</p>}
      {value && (
        <>
          <AsOf time={query.data!.serverTime} />
          <section className="report-panel">
            <h2>
              {value.provider} collection · {value.state}
            </h2>
            <p>
              Window: {value.window.startsAt ?? 'Not started'} through{' '}
              {value.window.endExclusive ?? 'Not confirmed'} (exclusive).{' '}
              {value.window.finalized ? 'Finalized.' : 'Provisional.'}
            </p>
            <p>
              Coverage:{' '}
              {value.coverage.availability === 'available'
                ? 'No known capture gaps'
                : value.coverage.availability === 'partial'
                  ? 'Partial capture'
                  : 'Unavailable'}
              {value.coverage.truncated ? ' · Interval details truncated' : ''}.
            </p>
            <dl className="report-details">
              {metrics.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    <Metric value={value[key]} />
                  </dd>
                </div>
              ))}
            </dl>
            <p className="report-muted">
              Unique submitters use provider account identity. Coverage does not guarantee every
              chat message was captured.
            </p>
          </section>
          <section className="report-panel">
            <h2>Current broadcast observation</h2>
            <p>
              Last reported state: {value.liveContext.state}. Viewer sample:{' '}
              {value.liveContext.liveViewers?.availability === 'available'
                ? value.liveContext.liveViewers.value
                : 'Unavailable'}
            </p>
            <p className="report-muted">
              Observed {value.liveContext.observedAt ?? 'Unavailable'} · Fresh until{' '}
              {value.liveContext.freshUntil ?? 'Unavailable'}. This is not historical audience for
              the collection window.
            </p>
          </section>
          <section className="report-panel">
            <h2>Accepted challenge lifetime</h2>
            <p>{value.financial.pendingCheckoutCount} pending checkouts.</p>
            <CurrencyRows rows={value.financial.contributionsByCurrency} />
            {value.financial.challengeId ? (
              <a href={'/challenges/' + value.financial.challengeId}>View accepted challenge</a>
            ) : (
              <p>No accepted challenge is associated with this round.</p>
            )}
          </section>
        </>
      )}
    </>
  );
}
