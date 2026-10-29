// Explicit synthetic contract fixtures. Only unit/browser acceptance imports this file.
import type {
  ChallengeDto,
  DashboardSummaryDto,
  DashboardMoneyDto,
  RoundAnalyticsResponseSchema,
  CompletionResponseSchema,
} from '../contracts/index';
export const reportingIds = {
  owner: '11223344-1234-4234-8234-112233445566',
  round: '44556677-1234-4234-8234-112233445566',
  broadcast: '33445566-1234-4234-8234-112233445566',
  challenge: '88990011-1234-4234-8234-112233445566',
  terms: '99001122-1234-4234-8234-112233445566',
  other: '00112233-1234-4234-8234-112233445566',
  run: '66778899-1234-4234-8234-112233445566',
  result: '77889900-1234-4234-8234-112233445566',
};
export const stamp = '2026-10-29T12:00:00.000Z';
export const syntheticReportingSession = {
  authenticated: true,
  user: {
    id: reportingIds.owner,
    displayName: 'Synthetic reporting creator',
    termsStatus: {
      status: 'accepted',
      documentId: 'synthetic',
      requiredVersion: 'v1',
      classification: 'development',
      contentHash: 'a'.repeat(64),
      acceptedVersion: 'v1',
      acceptedAt: stamp,
    },
  },
  expiresAt: '2030-01-01T00:00:00.000Z',
  csrfToken: 'a'.repeat(43),
};
export function moneyFixture(currency: 'USD' | 'EUR' = 'EUR'): DashboardMoneyDto {
  return {
    currency,
    paymentCount: 1,
    grossContributions: currency === 'EUR' ? '9007199254740993' : '1007',
    deadlineEligibleGross: '1000',
    lateGross: '7',
    timingUnclassifiedGross: '0',
    refundedGross: '0',
    reversedGross: '0',
    adjustedGross: null,
    remainingContributions: null,
    adjustmentReviewRequired: true,
    adjustmentInconsistent: false,
  };
}
export function dashboardFixture(): DashboardSummaryDto {
  return {
    dataAsOf: stamp,
    coverage: {
      records: 'retained_owner_records',
      contributions: 'verified_successes_only',
      adjustments: 'latest_verified_state_of_selected_contributions',
      historicalAudience: 'unavailable',
    },
    period: {
      timeZone: 'UTC',
      fromDate: '2026-10-01',
      throughDate: '2026-10-29',
      startInclusive: '2026-10-01T00:00:00.000Z',
      endExclusive: '2026-10-30T00:00:00.000Z',
      dataThrough: stamp,
      includesPartialToday: true,
    },
    history: {
      acceptedChallenges: 2,
      historicallyFundedChallenges: 1,
      streamerDeclaredCompletions: 0,
      contributionsByCurrency: [moneyFixture(), moneyFixture('USD')],
    },
    paymentsNeedingTimingReviewByCurrency: [],
    currentStream: {
      selection: 'not_selected',
      broadcastId: null,
      provider: null,
      state: 'not_selected',
      reason: 'not_selected',
      observedAt: null,
      freshUntil: null,
      liveViewers: null,
      totals: null,
    },
    recentActivity: {
      items: [
        {
          kind: 'challenge_accepted',
          id: reportingIds.other,
          challengeId: reportingIds.challenge,
          occurredAt: stamp,
        },
      ],
      hasMore: true,
    },
  };
}
export function reportingChallenge(): ChallengeDto {
  return {
    id: reportingIds.challenge,
    version: 1,
    publicId: reportingIds.other,
    roundId: reportingIds.round,
    stream: { provider: 'twitch', broadcastId: reportingIds.broadcast },
    acceptedAt: stamp,
    contentAvailability: 'available',
    terms: {
      version: reportingIds.terms,
      text: 'Draw a viewer-selected animal',
      goal: { amountMinor: '1000', currency: 'EUR' },
      fundingDurationSeconds: 600,
      fundingClosesAt: '2026-10-29T12:10:00.000Z',
      performanceRule: 'current_stream',
      policyVersion: 'synthetic-v1',
      sourceSuggestionId: reportingIds.result + '.g1',
      analysisRunId: reportingIds.run,
      snapshotVersion: 3,
    },
    authors: [
      { provider: 'twitch', displayName: 'Same viewer' },
      { provider: 'twitch', displayName: 'Same viewer' },
    ],
    funding: {
      version: 3,
      revision: 2,
      state: 'funded',
      confirmedGross: '1000',
      eligibleGross: '1000',
      lateGross: '0',
      unclassifiedGross: '0',
      surplusGross: '0',
      refundedGross: '0',
      reversedGross: '0',
      adjustedGross: null,
      remainingContributions: null,
      adjustmentInconsistent: false,
      goalReachedAt: stamp,
      pendingCheckoutCount: 0,
      reconciliationStatus: 'clear',
      reviewDueAt: '2026-10-29T12:20:00.000Z',
      financialReviewRequired: false,
      timingPolicyVersion: 'funding-v1',
      checkoutAvailability: { available: false, reasonCode: 'goal_reached' },
    },
    performance: {
      version: 1,
      revision: 1,
      state: 'awaiting_performance',
      startedAt: null,
      declarationId: null,
      declaredAt: null,
      verification: 'streamer_declaration',
      streamContextStatus: 'unobserved',
    },
    refundSummary: null,
    allowedActions: ['view_public'],
    contributionUrl: null,
  };
}
export function analyticsFixture(): ReturnType<typeof RoundAnalyticsResponseSchema.parse>['data'] {
  const unavailable = {
    value: null,
    availability: 'unavailable' as const,
    reasonCode: 'COVERAGE_GAP',
  };
  return {
    roundId: reportingIds.round,
    broadcastId: reportingIds.broadcast,
    provider: 'TWITCH',
    state: 'closed',
    window: {
      startsAt: '2026-10-29T11:59:30.000Z',
      endExclusive: stamp,
      finalized: true,
      timeBasis: 'server_receipt_time',
    },
    coverage: {
      availability: 'partial',
      reasonCode: 'COVERAGE_GAP',
      coveredIntervals: [],
      gapIntervals: [],
      truncated: false,
    },
    observedChatMessages: unavailable,
    eligibleSubmissions: { value: 0, availability: 'available', reasonCode: null },
    uniqueSubmitters: { value: 2, availability: 'partial', reasonCode: 'COVERAGE_GAP' },
    safeSuggestionCount: { value: 1, availability: 'available', reasonCode: null },
    pendingObservationCount: unavailable,
    identityBasis: 'provider_author_id',
    viewerSampleScope: 'current_broadcast_observation_not_round_history',
    liveContext: {
      state: 'unavailable',
      reason: 'observation_stale',
      observedAt: null,
      freshUntil: null,
      liveViewers: null,
    },
    financial: {
      scope: 'accepted_challenge_lifetime',
      challengeId: reportingIds.challenge,
      pendingCheckoutCount: 1,
      contributionsByCurrency: [moneyFixture()],
    },
  };
}
export function declarationFixture(): ReturnType<typeof CompletionResponseSchema.parse> {
  return {
    schemaVersion: 1,
    serverTime: stamp,
    data: {
      id: reportingIds.other,
      challengeId: reportingIds.challenge,
      termsVersion: reportingIds.terms,
      broadcastId: reportingIds.broadcast,
      provider: 'twitch',
      revision: 2,
      declaredAt: stamp,
      verification: 'streamer_declaration',
    },
  };
}
