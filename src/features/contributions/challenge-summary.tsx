import { useEffect, useState } from 'react';
import {
  contributionMoney,
  fundingPercent,
  type PublicChallengeDto,
} from '@/services/contributions/index';

import { fundingLabel } from './funding-label';

export function ChallengeSummary({
  value,
  serverTime,
  updatedAt,
}: {
  value: PublicChallengeDto;
  serverTime: string;
  updatedAt: number;
}) {
  const [browserTime, setBrowserTime] = useState(() => Date.now());
  const deadline = Date.parse(
    value.fundingWindow?.effectiveClosesAt ?? value.terms.fundingClosesAt,
  );
  const seconds = Math.max(
    0,
    Math.ceil((deadline - Date.parse(serverTime) - Math.max(0, browserTime - updatedAt)) / 1000),
  );
  const counting = value.funding.state === 'pending' && seconds > 0;
  useEffect(() => {
    if (!counting) return;
    const interval = window.setInterval(() => setBrowserTime(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [counting]);
  const currency = value.terms.goal.currency;
  const percent = fundingPercent(value);
  const label = fundingLabel(value, seconds);
  return (
    <header className="contribution-heading contribution-summary">
      {value.contentAvailability === 'available' && value.creator.displayName && (
        <p className="contribution-kicker">{value.creator.displayName}</p>
      )}
      <h1 className="contribution-viewer-text">
        {value.contentAvailability === 'available'
          ? value.terms.text
          : 'Challenge content unavailable'}
      </h1>
      <p className="contribution-raised">
        {contributionMoney(value.funding.eligibleGross, currency)} of{' '}
        {contributionMoney(value.terms.goal.amountMinor, currency)}
        <span> · {percent}%</span>
      </p>
      <progress max={100} value={percent} aria-label="Funding progress" />
      <p role="status">
        <strong>{label}</strong>
      </p>
      {counting && (
        <p className="contribution-muted">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} left
        </p>
      )}
    </header>
  );
}
