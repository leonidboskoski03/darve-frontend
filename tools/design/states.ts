import { ids } from '../../src/services/collection/fixture.test-helper';
import { contributionIds } from '../../src/services/contributions/fixture.test-helper';
import { displayId, grantId } from '../../src/services/realtime/fixtures.test-support';
import { reportingIds } from '../../src/services/reporting/fixture.test-helper';

import { ids as supportIds } from '../../src/services/support/fixture.test-helper';

const review = '/collection/' + ids.round + '/suggestions';
const overlay = '/overlay/' + displayId + '#grantId=' + grantId;

export const states = {
  signIn: ['Sign-in screen', '/authorize'],
  landing: ['Landing', '/welcome'],
  privacy: ['Legal · Privacy', '/privacy'],
  legalTerms: ['Legal · Terms', '/legal/terms'],
  safety: ['Legal · Safety', '/safety'],
  demo: ['Signed-in demo streamer', '/'],
  onboarding: ['Onboarding', '/onboarding'],
  connections: ['Connections', '/integrations'],
  verified: ['Payouts · verified', '/account/payments'],
  pending: ['Payouts · pending', '/account/payments'],
  attention: ['Payouts · needs attention', '/account/payments'],
  idle: ['Collection · idle', '/collection'],
  collecting: ['Collection · live preview', '/collection/' + ids.round],
  ended: ['Collection · ended', '/collection/' + ids.round],
  review: ['Review · top 10, uncertain and dismissed', review],
  accept: ['Accept idea dialog', review],
  obs: ['OBS settings', '/obs?displayId=' + displayId],
  overlayCollecting: ['Overlay · collecting', overlay],
  overlayChoosing: ['Overlay · choosing', overlay],
  overlayFunding: ['Overlay · funding', overlay],
  overlayGoal: ['Overlay · goal reached', overlay],
  overlayComplete: ['Overlay · completed', overlay],
  contribution: ['Public contribution page', '/contribute/' + contributionIds.public],
  receiptPending: ['Receipt · pending', '/receipts/' + contributionIds.checkout],
  receiptSucceeded: ['Receipt · succeeded', '/receipts/' + contributionIds.payment],
  dashboard: ['Dashboard', '/dashboard'],
  history: ['Challenge history', '/challenges'],
  challenge: ['Challenge detail', '/challenges/' + reportingIds.challenge],
  coins: ['Coins', '/coins'],
  templates: ['Templates', '/templates'],
  support: ['Support', '/support'],
  supportTicket: ['Support conversation', '/support/' + supportIds.ticket],
} as const;

export type DesignState = keyof typeof states;

export function isDesignState(value: string): value is DesignState {
  return Object.hasOwn(states, value);
}
