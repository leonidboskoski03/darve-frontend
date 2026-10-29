import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import {
  createReportingClient,
  reportingQuery,
  ReportingError,
  reportTime,
  type DashboardQuery,
} from '@/services/reporting/index';
import type { CreatorSession, CreatorSnapshot } from '@/services/creator-session/index';
import { AsOf, Totals, CurrencyRows, ReportProblem } from './common';
import { SourcePicker } from './source-picker';
import './reporting.css';
const activityLabels = {
  challenge_accepted: 'Challenge accepted',
  goal_recognized: 'Goal recognized',
  streamer_declared: 'Streamer declared completion',
  provider_success_reference: 'Verified contribution reference',
};
export function Dashboard({
  session,
  snapshot,
  input,
  onApply,
}: {
  session: CreatorSession;
  snapshot: CreatorSnapshot;
  input: DashboardQuery;
  onApply: (value: DashboardQuery) => void;
}) {
  const client = useMemo(() => createReportingClient(session), [session]);
  const validation = useMemo(() => {
    try {
      return reportingQuery(input);
    } catch (error) {
      return error as ReportingError;
    }
  }, [input]);
  const [draft, setDraft] = useState({
    timeZone: input.timeZone,
    fromDate: input.fromDate ?? '',
    throughDate: input.throughDate ?? '',
    broadcastId: input.broadcastId ?? '',
  });
  const [problem, setProblem] = useState<unknown>(null);
  const [choosingSource, setChoosingSource] = useState(false);
  const query = useQuery({
    queryKey: snapshot.scope.key(['dashboard', input]),
    enabled: !(validation instanceof ReportingError),
    queryFn: ({ signal }) => client.summary(input, signal),
    retry: false,
  });
  const value = !query.isError ? query.data?.data : undefined;
  return (
    <>
      <header className="report-heading">
        <span>Your stream · Your records</span>
        <h1>Dashboard</h1>
        <p>
          Retained challenge activity and verified contributions, with each currency kept separate.
        </p>
      </header>
      <section className="report-panel">
        <h2>Reporting period</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setProblem(null);
            try {
              onApply(
                reportingQuery({
                  timeZone: draft.timeZone,
                  ...(draft.fromDate ? { fromDate: draft.fromDate } : {}),
                  ...(draft.throughDate ? { throughDate: draft.throughDate } : {}),
                  ...(draft.broadcastId ? { broadcastId: draft.broadcastId } : {}),
                }),
              );
            } catch (error) {
              setProblem(error);
            }
          }}
        >
          <div className="report-form-grid">
            <label className="ds-field">
              <span className="ds-field__label">Reporting timezone</span>
              <input
                className="ds-input"
                value={draft.timeZone}
                onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}
                placeholder="Europe/Warsaw"
                required
              />
            </label>
            <label className="ds-field">
              <span className="ds-field__label">From date</span>
              <input
                className="ds-input"
                type="date"
                value={draft.fromDate}
                onChange={(event) => setDraft({ ...draft, fromDate: event.target.value })}
              />
            </label>
            <label className="ds-field">
              <span className="ds-field__label">Through date</span>
              <input
                className="ds-input"
                type="date"
                value={draft.throughDate}
                onChange={(event) => setDraft({ ...draft, throughDate: event.target.value })}
              />
            </label>
          </div>
          <p className="report-muted">
            Choose both dates or leave both empty for the server's default period. Dates are civil
            days in the chosen timezone.
          </p>
          <details onToggle={(event) => setChoosingSource(event.currentTarget.open)}>
            <summary>Choose a broadcast</summary>
            {choosingSource && (
              <SourcePicker
                session={session}
                snapshot={snapshot}
                value={draft.broadcastId}
                onChange={(broadcastId) => setDraft({ ...draft, broadcastId })}
              />
            )}
          </details>
          <ReportProblem error={problem} />
          <div className="report-actions">
            <Button type="submit">Apply reporting filters</Button>
            <Button
              tone="secondary"
              busy={query.isFetching}
              disabled={validation instanceof ReportingError}
              onClick={() => {
                void query.refetch();
              }}
            >
              Refresh dashboard
            </Button>
          </div>
        </form>
      </section>
      <ReportProblem error={validation instanceof ReportingError ? validation : query.error} />
      {query.isPending && !(validation instanceof ReportingError) && (
        <p role="status">Loading dashboard…</p>
      )}
      {value && (
        <>
          <AsOf time={value.dataAsOf} zone={value.period.timeZone} />
          <p className="report-muted">
            {value.period.fromDate} through {value.period.throughDate} · {value.period.timeZone}.{' '}
            {value.period.includesPartialToday
              ? 'Includes a partial current day.'
              : 'Selected reporting interval.'}
          </p>
          <p className="report-muted">
            Server interval: {value.period.startInclusive} inclusive to {value.period.endExclusive}{' '}
            exclusive. Data through {value.period.dataThrough}.
          </p>
          <section className="report-panel">
            <h2>Date-filtered history</h2>
            <Totals value={value.history} />
            <CurrencyRows rows={value.history.contributionsByCurrency} />
            <p className="report-muted">
              Verified successful contributions and their latest verified adjustments. Historical
              audience is unavailable.
            </p>
          </section>
          <section className="report-panel">
            <h2>Payments needing timing review</h2>
            <p className="report-muted">
              These retained payments lack reliable timing and are outside the dated totals.
            </p>
            <CurrencyRows rows={value.paymentsNeedingTimingReviewByCurrency} />
          </section>
          <section className="report-panel">
            <h2>Selected broadcast · retained totals</h2>
            {value.currentStream.selection === 'not_selected' ? (
              <p>
                No broadcast is selected. Choose one in Reporting period to inspect its retained
                totals.
              </p>
            ) : (
              <>
                <p>
                  {value.currentStream.provider} · Last reported state: {value.currentStream.state}.{' '}
                  {value.currentStream.state === 'unavailable'
                    ? 'A current observation is unavailable.'
                    : ''}
                </p>
                <p className="report-muted">
                  Observation: {value.currentStream.observedAt ?? 'Unavailable'} · Fresh until:{' '}
                  {value.currentStream.freshUntil ?? 'Unavailable'}
                </p>
                <p>
                  Current broadcast viewer sample:{' '}
                  {value.currentStream.liveViewers?.availability === 'available'
                    ? value.currentStream.liveViewers.value?.toLocaleString('en')
                    : 'Unavailable'}
                </p>
                <p className="report-muted">This sample is not historical round audience.</p>
                {value.currentStream.totals ? (
                  <>
                    <Totals value={value.currentStream.totals} />
                    <CurrencyRows rows={value.currentStream.totals.contributionsByCurrency} />
                  </>
                ) : (
                  <p>Broadcast totals are unavailable.</p>
                )}
              </>
            )}
          </section>
          <section className="report-panel">
            <h2>Recent activity</h2>
            {value.recentActivity.items.length === 0 ? (
              <p>No retained activity in this reporting interval.</p>
            ) : (
              <ol className="report-activity">
                {value.recentActivity.items.map((item, index) => (
                  <li key={`${item.kind}:${item.id}:${index}`}>
                    <a href={'/challenges/' + item.challengeId}>{activityLabels[item.kind]}</a>
                    <time dateTime={item.occurredAt}>
                      {reportTime(item.occurredAt, value.period.timeZone)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
            {value.recentActivity.hasMore && (
              <p>More activity exists. Open challenge history to inspect retained challenges.</p>
            )}
            <a href="/challenges">Open challenge history</a>
          </section>
        </>
      )}
    </>
  );
}
