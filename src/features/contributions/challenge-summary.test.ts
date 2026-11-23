import { describe, expect, it } from 'vitest';
import { fundingLabel } from './funding-label';

const open = { funding: { state: 'pending' }, checkoutAvailability: { available: true } } as const;

describe('viewer funding status', () => {
  it('displays an open window and closes the countdown without claiming success', () => {
    expect(fundingLabel(open, 1)).toBe('Open for contributions');
    expect(fundingLabel(open, 0)).toBe('Funding closed');
  });

  it('distinguishes a confirmed goal from an unsuccessful close even at zero seconds', () => {
    expect(fundingLabel({ ...open, funding: { state: 'funded' } }, 0)).toBe(
      'Goal reached — thank you!',
    );
    expect(fundingLabel({ ...open, funding: { state: 'unsuccessful' } }, 0)).toBe('Funding closed');
  });

  it.each([
    ['reconciliation_required', 'Confirming a payment…'],
    ['goal_reached', 'Goal reached — thank you!'],
    ['deadline_passed', 'Funding closed'],
    ['receiving_unavailable', 'Contributions unavailable'],
    ['payments_unconfigured', 'Contributions unavailable'],
    ['account_restricted', 'Contributions unavailable'],
    ['source_unavailable', 'Contributions unavailable'],
  ] as const)('maps %s to a viewer status', (reasonCode, label) => {
    expect(
      fundingLabel({ ...open, checkoutAvailability: { available: false, reasonCode } }, 20),
    ).toBe(label);
  });
});
