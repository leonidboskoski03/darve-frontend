import { reportingMessage, moneyText, reportTime } from '@/services/reporting/index';
import type { DashboardMoneyDto, DashboardTotalsDto } from '@/services/contracts/index';
export function ReportProblem({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="report-warning">
      {reportingMessage(error)}
    </p>
  ) : null;
}
export function AsOf({ time, zone = 'UTC' }: { time: string; zone?: string }) {
  return (
    <p className="report-muted">
      Snapshot as of <time dateTime={time}>{reportTime(time, zone)}</time> · {zone}. Refresh for
      current status.
    </p>
  );
}
export function Totals({ value }: { value: DashboardTotalsDto }) {
  return (
    <dl className="report-stats">
      <div>
        <dt>Accepted challenges</dt>
        <dd>{value.acceptedChallenges.toLocaleString('en')}</dd>
      </div>
      <div>
        <dt>Historically funded challenges</dt>
        <dd>{value.historicallyFundedChallenges.toLocaleString('en')}</dd>
      </div>
      <div>
        <dt>Streamer-declared completions</dt>
        <dd>{value.streamerDeclaredCompletions.toLocaleString('en')}</dd>
      </div>
    </dl>
  );
}
const columns = [
  ['grossContributions', 'Gross contributions'],
  ['deadlineEligibleGross', 'Deadline-eligible gross'],
  ['lateGross', 'Late gross'],
  ['timingUnclassifiedGross', 'Timing unclassified'],
  ['refundedGross', 'Refunded gross'],
  ['reversedGross', 'Reversed gross'],
  ['adjustedGross', 'Adjusted gross'],
  ['remainingContributions', 'Remaining contributions'],
] as const;
export function CurrencyRows({ rows }: { rows: DashboardMoneyDto[] }) {
  return rows.length === 0 ? (
    <p className="report-muted">No verified contribution rows in this scope.</p>
  ) : (
    <div className="report-money">
      {rows.map((row) => (
        <article className="report-currency" key={row.currency}>
          <h3>{row.currency}</h3>
          <p>{row.paymentCount} verified payments</p>
          <dl>
            {columns.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{moneyText(row[key], row.currency)}</dd>
              </div>
            ))}
          </dl>
          {row.adjustmentReviewRequired && <p role="status">Adjustment review is required.</p>}
          {row.adjustmentInconsistent && (
            <p role="status">Adjustment information is inconsistent.</p>
          )}
        </article>
      ))}
    </div>
  );
}
