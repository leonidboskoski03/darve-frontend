import type { PublicChallengeDto } from '@/services/contributions/index';
export function fundingLabel(
  value: {
    funding: Pick<PublicChallengeDto['funding'], 'state'>;
    checkoutAvailability: PublicChallengeDto['checkoutAvailability'];
  },
  seconds: number,
) {
  if (value.funding.state === 'funded') return 'Goal reached — thank you!';
  if (value.funding.state === 'unsuccessful') return 'Funding closed';
  if (!value.checkoutAvailability.available) {
    switch (value.checkoutAvailability.reasonCode) {
      case 'reconciliation_required':
        return 'Confirming a payment…';
      case 'deadline_passed':
        return 'Funding closed';
      case 'goal_reached':
        return 'Goal reached — thank you!';
      case 'account_restricted':
      case 'source_unavailable':
      case 'payments_unconfigured':
      case 'receiving_unavailable':
        return seconds > 0 ? 'Contributions unavailable' : 'Funding closed';
    }
  }
  return seconds > 0 ? 'Open for contributions' : 'Funding closed';
}
