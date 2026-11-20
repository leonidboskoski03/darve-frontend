import { consumerMoney, type ChallengeDto } from '@/services/contracts/index';
export const moneyText = (value: string | null, currency: string) =>
  value === null
    ? 'Unavailable'
    : ['EUR', 'USD'].includes(currency)
      ? `${consumerMoney(value, currency).decimal} ${currency}`
      : `${value} minor units · ${currency}`;
export { creatorTime as reportTime } from '@/shared/creator-time';
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

export function publicPaymentLink(challenge: ChallengeDto) {
  if (
    challenge.contentAvailability !== 'available' ||
    !challenge.allowedActions.includes('view_public') ||
    !challenge.contributionUrl
  )
    return null;
  const path = '/contribute/' + challenge.publicId;
  try {
    const url = new URL(challenge.contributionUrl);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === path
    )
      return { path, shareUrl: url.href };
  } catch {
    return null;
  }
  return null;
}
