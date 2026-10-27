import {
  OverlaySnapshotResponseSchema,
  OverlaySnapshotV2ResponseSchema,
} from '@/services/contracts/index';

export const displayId = '11223344-1234-4234-8234-112233445566';
export const grantId = '22334455-1234-4234-8234-112233445566';
export const foreignId = '33445566-1234-4234-8234-112233445566';
export const serverTime = '2026-10-27T12:00:00.000Z';
export const iso = (seconds: number) =>
  new Date(Date.parse(serverTime) + seconds * 1000).toISOString();
export function makeFrame(protocol: 1 | 2 = 1, version = 1, seconds = 0) {
  const styles = { position: 'bottom_left', scale: 1, opacity: 1, marginX: 0, marginY: 0 };
  const data = {
    id: displayId,
    version,
    bindingVersion: 1,
    presentationState: 'idle',
    roundId: null,
    challengeId: null,
    collectionClosesAt: null,
    challenge: null,
    qrPayload: null,
    preferences:
      protocol === 1
        ? { version: 1, styles: { ...styles, themeStyle: 'standalone' } }
        : {
            version: 1,
            styles,
            template: {
              revision: 1,
              templateId: 'standalone',
              assetVersion: 1,
              available: true,
              renderer: { key: 'standalone', hash: null },
            },
          },
  };
  const frame = { schemaVersion: protocol, serverTime: iso(seconds), data };
  return protocol === 1
    ? OverlaySnapshotResponseSchema.parse(frame)
    : OverlaySnapshotV2ResponseSchema.parse(frame);
}
export function acceptedFrame(protocol: 1 | 2 = 1) {
  const base = makeFrame(protocol);
  const challenge = {
    publicId: foreignId,
    creator: { displayName: 'Synthetic creator' },
    acceptedAt: serverTime,
    contentAvailability: 'available',
    terms: {
      version: grantId,
      text: 'Synthetic challenge',
      goal: { amountMinor: '9007199254740993', currency: 'EUR' },
      fundingDurationSeconds: 60,
      fundingClosesAt: iso(60),
      performanceRule: 'current_stream',
      policyVersion: 'synthetic',
    },
    authors: [{ provider: 'twitch', displayName: 'Synthetic viewer' }],
    funding: {
      version: 3,
      revision: 1,
      state: 'pending',
      confirmedGross: '9007199254740992',
      eligibleGross: '9007199254740992',
      lateGross: '0',
      unclassifiedGross: '0',
      surplusGross: '0',
      refundedGross: '0',
      reversedGross: '0',
      adjustedGross: '0',
      remainingContributions: '0',
      adjustmentInconsistent: false,
      goalReachedAt: null,
      pendingCheckoutCount: 0,
      reconciliationStatus: 'clear',
      reviewDueAt: iso(660),
      financialReviewRequired: false,
      timingPolicyVersion: 'funding-v1',
      checkoutAvailability: { available: false, reasonCode: 'payments_unconfigured' },
    },
    performance: {
      version: 1,
      revision: 1,
      state: 'awaiting_funding',
      startedAt: null,
      declarationId: null,
      declaredAt: null,
      verification: 'streamer_declaration',
      streamContextStatus: 'unobserved',
    },
    checkoutAvailability: { available: false, reasonCode: 'payments_unconfigured' },
    availablePaymentProviders: ['stripe', 'paypal'].map((provider) => ({
      provider,
      availability: { available: false, reasonCode: 'payments_unconfigured' },
    })),
    contributionUrl: 'https://example.test/c/synthetic',
  };
  const frame = {
    ...base,
    data: {
      ...base.data,
      presentationState: 'accepted',
      roundId: grantId,
      challengeId: foreignId,
      challenge,
      qrPayload: challenge.contributionUrl,
    },
  };
  return protocol === 1
    ? OverlaySnapshotResponseSchema.parse(frame)
    : OverlaySnapshotV2ResponseSchema.parse(frame);
}
export function makeEvent(frame: ReturnType<typeof makeFrame>, type = 'overlay.snapshot') {
  return {
    schemaVersion: frame.schemaVersion,
    eventId: `${frame.data.id}.v${frame.data.version}`,
    occurredAt: frame.serverTime,
    resourceType: 'overlay',
    resourceId: frame.data.id,
    resourceVersion: frame.data.version,
    type,
    data: frame.data,
  };
}
export const wireEvent = (event: ReturnType<typeof makeEvent>) =>
  `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
