import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import {
  createReportingClient,
  canDeclare,
  moneyText,
  reportTime,
  fundingLabel,
  performanceLabel,
  type ChallengeDto,
  type DeclarationAttempt,
  type Declaration,
} from '@/services/reporting/index';
import type { CreatorSession, CreatorSnapshot } from '@/services/creator-session/index';
import { AsOf, ReportProblem } from './common';
import { DeclarationDialog } from './declaration-dialog';
import './reporting.css';
export function ChallengeDetail({
  session,
  snapshot,
  id,
}: {
  session: CreatorSession;
  snapshot: CreatorSnapshot;
  id: string;
}) {
  const client = useMemo(() => createReportingClient(session), [session]);
  const key = snapshot.scope.key(['challenge', id]);
  const [selected, setSelected] = useState<{
      challenge: ChallengeDto;
      attempt: DeclarationAttempt;
    } | null>(null),
    [recorded, setRecorded] = useState<Declaration | null>(null),
    [problem, setProblem] = useState<unknown>(null);
  const heading = useRef<HTMLHeadingElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    returnFocus = useRef(false);
  useEffect(() => {
    if (!selected && returnFocus.current) {
      (trigger.current && !trigger.current.disabled ? trigger.current : heading.current)?.focus();
      returnFocus.current = false;
    }
  }, [selected]);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => client.challenge(id, signal),
    retry: false,
  });
  const value = !query.isError ? query.data?.data : undefined;
  const onSuccess = (declaration: Declaration) => {
    setRecorded(declaration);
    setSelected(null);
    returnFocus.current = true;
    for (const prefix of [
      ['challenge', id],
      ['challenge-history'],
      ['dashboard'],
      ['round-analytics'],
      ['review-challenge'],
    ])
      void snapshot.scope.queryClient.invalidateQueries({ queryKey: snapshot.scope.key(prefix) });
  };
  return (
    <>
      <header className="report-heading">
        <span>Your stream · Your commitment</span>
        <h1 ref={heading} tabIndex={-1}>
          Challenge details
        </h1>
        <p>
          Funding and performance are separate records. Keep the original accepted terms in view.
        </p>
      </header>
      <div className="report-actions">
        <a href="/challenges">Back to challenge history</a>
        <Button
          tone="secondary"
          busy={query.isFetching}
          disabled={!!selected}
          onClick={() => {
            setProblem(null);
            void query.refetch();
          }}
        >
          Refresh challenge details
        </Button>
      </div>
      <ReportProblem error={query.error ?? problem} />
      {query.isPending && <p role="status">Loading challenge details…</p>}
      {recorded && (
        <p role="status">
          Your completion declaration was recorded {reportTime(recorded.declaredAt)} UTC.
          Verification: streamer declaration.
        </p>
      )}
      {value && (
        <>
          <AsOf time={query.data!.serverTime} />
          <section className="report-panel">
            <span className="report-eyebrow">
              {value.stream.provider} · {fundingLabel(value.funding.state)}
            </span>
            <h2 className="report-source-text">
              {value.contentAvailability === 'available'
                ? value.terms.text
                : 'Challenge content unavailable'}
            </h2>
            <p>{performanceLabel(value.performance.state)}</p>
            <dl className="report-details">
              <div>
                <dt>Accepted goal</dt>
                <dd>{moneyText(value.terms.goal.amountMinor, value.terms.goal.currency)}</dd>
              </div>
              <div>
                <dt>Funding duration</dt>
                <dd>{value.terms.fundingDurationSeconds} seconds</dd>
              </div>
              <div>
                <dt>Accepted</dt>
                <dd>{reportTime(value.acceptedAt)} UTC</dd>
              </div>
              <div>
                <dt>Funding closes</dt>
                <dd>
                  {reportTime(
                    value.fundingWindow?.effectiveClosesAt ?? value.terms.fundingClosesAt,
                  )}{' '}
                  UTC
                </dd>
              </div>
              <div>
                <dt>Verified gross contributions</dt>
                <dd>{moneyText(value.funding.confirmedGross, value.terms.goal.currency)}</dd>
              </div>
              <div>
                <dt>Eligible gross</dt>
                <dd>{moneyText(value.funding.eligibleGross, value.terms.goal.currency)}</dd>
              </div>
              <div>
                <dt>Late gross</dt>
                <dd>{moneyText(value.funding.lateGross, value.terms.goal.currency)}</dd>
              </div>
              <div>
                <dt>Timing unclassified</dt>
                <dd>{moneyText(value.funding.unclassifiedGross, value.terms.goal.currency)}</dd>
              </div>
              <div>
                <dt>Refunded gross</dt>
                <dd>{moneyText(value.funding.refundedGross, value.terms.goal.currency)}</dd>
              </div>
              <div>
                <dt>Reversed gross</dt>
                <dd>{moneyText(value.funding.reversedGross, value.terms.goal.currency)}</dd>
              </div>
              <div>
                <dt>Adjusted gross</dt>
                <dd>{moneyText(value.funding.adjustedGross, value.terms.goal.currency)}</dd>
              </div>
              <div>
                <dt>Remaining contributions</dt>
                <dd>
                  {moneyText(value.funding.remainingContributions, value.terms.goal.currency)}
                </dd>
              </div>
              <div>
                <dt>Pending checkouts</dt>
                <dd>{value.funding.pendingCheckoutCount}</dd>
              </div>
              <div>
                <dt>Reconciliation</dt>
                <dd>
                  {value.funding.reconciliationStatus === 'clear'
                    ? 'Clear'
                    : value.funding.reconciliationStatus === 'checking'
                      ? 'Checking'
                      : 'Needs review'}
                </dd>
              </div>
            </dl>
            {(value.funding.financialReviewRequired || value.funding.adjustmentInconsistent) && (
              <p role="status">
                Financial information needs review. Historical goal recognition is separate from
                later adjustments.
              </p>
            )}
            {value.fundingWindow && (
              <details>
                <summary>Funding window policy</summary>
                <p>{value.fundingWindow.disclosure}</p>
                <p>
                  Original close: {value.fundingWindow.originalClosesAt}. Additional time:{' '}
                  {value.fundingWindow.cumulativeSeconds} seconds.
                </p>
              </details>
            )}
            {value.performanceAuthority && (
              <p className="report-muted">
                {value.performanceAuthority.revision > 0
                  ? 'Authorized continuation stream'
                  : 'Original stream'}
                : {value.performanceAuthority.broadcastId}
              </p>
            )}
            <details>
              <summary>All {value.authors.length} projected author credits</summary>
              <ul>
                {value.authors.map((author, index) => (
                  <li key={index}>
                    {author.displayName ?? 'Unnamed viewer'} · {author.provider}
                  </li>
                ))}
              </ul>
            </details>
            <div className="report-actions">
              <a href={'/collection/' + value.roundId + '/analytics'}>View round analytics</a>
              <a href={'/collection/' + value.roundId + '/suggestions'}>Review source ideas</a>
            </div>
            {canDeclare(value) && !recorded ? (
              <Button
                ref={trigger}
                disabled={query.isFetching}
                onClick={() => {
                  try {
                    setProblem(null);
                    setSelected({ challenge: value, attempt: client.prepare(value) });
                  } catch (error) {
                    setProblem(error);
                  }
                }}
              >
                Declare completion
              </Button>
            ) : (
              <p className="report-muted">
                {recorded
                  ? 'Your declaration is recorded. Refresh to reconcile the latest challenge status.'
                  : value.performance.state === 'declared_complete'
                    ? 'Completion is already recorded as a streamer declaration.'
                    : value.contentAvailability !== 'available'
                      ? 'The source is unavailable; declaration cannot be prepared.'
                      : 'Completion declaration requires a server-recognized funded challenge awaiting performance.'}
              </p>
            )}
            {value.performance.declaredAt && (
              <p>Declared {reportTime(value.performance.declaredAt)} UTC · Streamer declaration.</p>
            )}
          </section>
        </>
      )}
      {selected && (
        <DeclarationDialog
          client={client}
          challenge={selected.challenge}
          current={value}
          attempt={selected.attempt}
          available={!!value && !query.isFetching}
          onDismiss={() => {
            returnFocus.current = true;
            setSelected(null);
          }}
          onReconcile={() => query.refetch()}
          onSuccess={onSuccess}
        />
      )}
    </>
  );
}
