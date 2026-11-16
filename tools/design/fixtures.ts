import * as contracts from '@darve/contracts';
import { ids, roundFixture } from '../../src/services/collection/fixture.test-helper';
import {
  contributionIds,
  privateReceiptFixture,
  publicContributionFixture,
} from '../../src/services/contributions/fixture.test-helper';
import {
  idea,
  preview,
  publishedEvent,
  state,
} from '../../src/services/realtime/analysis-live.test-support';
import { makeFrame } from '../../src/services/realtime/fixtures.test-support';
import { reviewFixture, reviewIds } from '../../src/services/suggestions/fixture.test-helper';
import type { DesignState } from './states';

export const streamer = 'Avery Draws';
export const titles = [
  'Draw a capybara running a coffee shop',
  'Turn a viewer’s pet into a fantasy boss',
  'Design an underwater train station',
  'Draw a tiny dragon guarding a library',
  'Turn chat emotes into a movie poster',
  'Illustrate a mushroom village at sunset',
  'Invent a mascot for the next stream',
  'Paint a floating garden in three colors',
  'Create a trading card for the channel cat',
  'Sketch a detective who is also a pigeon',
  'Build a character around a random sound',
  'Redraw yesterday’s sketch upside down',
];

const reasons = [
  'The recognizable animal and café setting make for an easy-to-share reveal.',
  'Chat can help invent the boss’s moves while the drawing takes shape.',
  'The setting gives viewers plenty of details to suggest along the way.',
  'A tiny character and oversized setting create an immediate visual joke.',
  'Regulars will recognize the emotes and can vote on the movie genre.',
  'The scene is achievable in one stream and leaves room for chat suggestions.',
  'The finished design could appear on future streams.',
  'The three-color limit makes the challenge easy to understand.',
  'A trading card gives the drawing a clear, shareable format.',
  'The detective premise gives the streamer a playful character to develop.',
];

export const time = (offset = 0) => new Date(Date.now() + offset).toISOString();
export const envelope = (data: unknown) => ({ schemaVersion: 1, serverTime: time(), data });
export const page = (items: unknown[]) => ({ items, nextCursor: null });

export function review() {
  const base = reviewFixture();
  return {
    ...base,
    items: titles.map((text, index) => ({
      ...base.items[0],
      id: reviewIds.result + '.g' + (index + 1),
      text,
      description: 'A viewer suggestion from the illustration stream.',
      rank: index + 1,
      creativityExplanation: reasons[index] ?? null,
      viralPotentialExplanation: null,
      isRecommended: index < 10,
      dismissed: index === 11,
      authors: base.items[0].authors.map((author, i) => ({
        ...author,
        displayName: i === 0 ? 'mossandink' : 'pixelotter',
      })),
      createdAt: time(-120_000),
    })),
    totalSafeCount: titles.length,
    recommendedCount: 10,
  };
}

export function round(mode: 'collecting' | 'closed', duration = 60, stopped = false) {
  const frame = roundFixture(mode, Date.now());
  const collecting = mode === 'collecting';
  frame.data.collectionDurationSeconds = duration;
  const base = Date.parse(frame.serverTime);
  const startedAt = collecting
    ? base
    : base - (stopped ? Math.floor(duration / 2) : duration) * 1000;
  frame.data.startedAt = new Date(startedAt).toISOString();
  frame.data.closesAt = new Date(startedAt + duration * 1000).toISOString();
  if (stopped) frame.data.closeReason = 'STOPPED';
  frame.data.counts = { admittedSubmissions: 46, distinctSubmitters: 29 };
  const stream = frame.data.streamContext!;
  stream.capturedAt = frame.data.startedAt;
  stream.title.observedAt = frame.data.startedAt;
  stream.title.value = 'Sketchbook Sunday · chat picks what I draw next';
  return {
    ...frame,
    data: {
      ...frame.data,
      analysis: collecting
        ? null
        : {
            ...frame.data.analysis,
            analysisRunId: reviewIds.run,
            state: 'succeeded',
            resultVersion: reviewIds.result,
          },
    },
  };
}

export function analysisEvents(collecting: boolean) {
  return collecting
    ? [
        { ...state('open'), roundId: ids.round },
        {
          ...preview(...titles.slice(0, 5).map((title, i) => idea(i + 1, 21 - i * 3, title))),
          roundId: ids.round,
        },
      ]
    : [
        {
          ...publishedEvent(false, false, 10),
          roundId: ids.round,
          resultVersion: reviewIds.result,
          suggestions: titles.slice(0, 10).map((title, i) => ({
            id: 'g' + (i + 1),
            title,
            supporterCount: 24 - i * 2,
            order: i + 1,
            reason: reasons[i],
          })),
        },
      ];
}

export function publicChallenge(origin: string, mode: DesignState) {
  const base = publicContributionFixture(true).data;
  const funded = mode === 'overlayGoal' || mode === 'overlayComplete';
  const done = mode === 'overlayComplete';
  const total = funded ? '5000' : '3250';
  const availability = funded
    ? { available: false, reasonCode: 'goal_reached' }
    : { available: true };
  return {
    ...base,
    creator: { displayName: streamer },
    acceptedAt: time(-120_000),
    terms: {
      ...base.terms,
      text: titles[0],
      goal: { amountMinor: '5000', currency: 'EUR' },
      fundingClosesAt: time(480_000),
    },
    authors: [
      { provider: 'twitch', displayName: 'mossandink' },
      { provider: 'twitch', displayName: 'pixelotter' },
    ],
    funding: {
      ...base.funding,
      state: funded ? 'funded' : 'pending',
      confirmedGross: total,
      eligibleGross: total,
      lateGross: '0',
      remainingContributions: funded ? '0' : '1750',
      goalReachedAt: funded ? time(-60_000) : null,
      reviewDueAt: time(1_080_000),
      checkoutAvailability: availability,
    },
    performance: {
      ...base.performance,
      revision: done ? 2 : 1,
      streamContextStatus: done ? 'confirmed_original_broadcast' : 'unobserved',
      state: done ? 'declared_complete' : funded ? 'awaiting_performance' : 'awaiting_funding',
      declarationId: done ? contributionIds.other : null,
      declaredAt: done ? time(-5_000) : null,
    },
    checkoutAvailability: availability,
    availablePaymentProviders: base.availablePaymentProviders.map((row) => ({
      ...row,
      availability,
    })),
    contributionUrl: origin + '/contribute/' + contributionIds.public,
  };
}

export function receipt(
  id: string,
  input?: { amountMinor: string; paymentProvider: 'stripe' | 'paypal' },
) {
  const base = privateReceiptFixture(input?.paymentProvider).data;
  const succeeded = id === contributionIds.payment;
  return {
    ...base,
    id,
    createdAt: time(-30_000),
    state: succeeded ? 'succeeded' : 'awaiting',
    amount: { ...base.amount, amountMinor: input?.amountMinor ?? '1000' },
    darveFee: { ...base.darveFee, amountMinor: '50' },
    payments: succeeded
      ? [
          {
            id: contributionIds.other,
            amountMinor: '1000',
            paidAt: time(-10_000),
            eligibilityReferenceAt: time(-10_000),
            eligibilityTimeBasis: 'stripe_success_event',
            eligibility: 'eligible',
          },
        ]
      : [],
  };
}

export const defaultOverlay = () =>
  contracts.OverlaySnapshotV2ResponseSchema.parse(makeFrame(2)).data;

export function overlay(
  origin: string,
  mode: DesignState,
  preferences = defaultOverlay().preferences,
) {
  const base = defaultOverlay();
  const collecting = mode === 'overlayCollecting';
  const choosing = mode === 'overlayChoosing';
  const challenge = ['overlayFunding', 'overlayGoal', 'overlayComplete'].includes(mode)
    ? publicChallenge(origin, mode)
    : null;

  return contracts.OverlaySnapshotV2ResponseSchema.parse({
    schemaVersion: 2,
    serverTime: time(),
    data: {
      ...base,
      preferences,
      presentationState: challenge
        ? 'accepted'
        : collecting
          ? 'collecting'
          : choosing
            ? 'choosing'
            : 'idle',
      roundId: challenge || collecting || choosing ? ids.round : null,
      challengeId: challenge ? reviewIds.challenge : null,
      collectionClosesAt: collecting ? time(510_000) : null,
      challenge,
      qrPayload: mode === 'overlayFunding' ? challenge?.contributionUrl : null,
    },
  });
}
