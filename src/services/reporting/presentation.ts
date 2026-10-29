import { consumerMoney, type ChallengeDto } from '@/services/contracts/index';
export const moneyText = (value: string | null, currency: string) =>
  value === null
    ? 'Unavailable'
    : ['EUR', 'USD'].includes(currency)
      ? `${consumerMoney(value, currency).decimal} ${currency}`
      : `${value} minor units · ${currency}`;
export const reportTime = (value: string, timeZone = 'UTC') =>
  new Intl.DateTimeFormat('en', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
export const fundingLabel = (value: ChallengeDto['funding']['state']) =>
  ({
    pending: 'Awaiting funding',
    funded: 'Goal recognized',
    unsuccessful: 'Funding unsuccessful',
  })[value];
export const performanceLabel = (value: ChallengeDto['performance']['state']) =>
  ({
    awaiting_funding: 'Awaiting funding',
    awaiting_performance: 'Awaiting your declaration',
    declared_complete: 'Streamer declared complete',
  })[value];
