// Explicitly synthetic contract fixtures; imported by tests only, never the product entry.
export const ids = {
  owner: '11223344-1234-4234-8234-112233445566',
  connection: '22334455-1234-4234-8234-112233445566',
  broadcast: '33445566-1234-4234-8234-112233445566',
  round: '44556677-1234-4234-8234-112233445566',
  snapshot: '55667788-1234-4234-8234-112233445566',
};
export const syntheticSession = {
  authenticated: true,
  user: {
    id: ids.owner,
    displayName: 'Synthetic collection creator',
    termsStatus: {
      status: 'accepted',
      documentId: 'synthetic',
      requiredVersion: 'v1',
      classification: 'development',
      contentHash: 'a'.repeat(64),
      acceptedVersion: 'v1',
      acceptedAt: '2026-10-29T12:00:00.000Z',
    },
  },
  expiresAt: '2030-01-01T00:00:00.000Z',
  csrfToken: 'a'.repeat(43),
};
export function roundFixture(
  state: 'preparing' | 'collecting' | 'closed' | 'failed' = 'preparing',
  base = Date.parse('2026-10-29T12:00:00.000Z'),
) {
  const time = (delta = 0) => new Date(base + delta).toISOString();
  const activated = state === 'collecting' || state === 'closed';
  const started = state === 'closed' ? time(-30000) : time();
  const absent = { value: null, availability: 'unavailable', observedAt: null };
  return {
    schemaVersion: 1,
    serverTime: time(),
    data: {
      id: ids.round,
      version: state === 'preparing' ? 1 : state === 'collecting' ? 2 : 3,
      ownerId: ids.owner,
      provider: 'twitch',
      connectionId: ids.connection,
      channelId: ids.owner,
      broadcastId: ids.broadcast,
      categoryKey: null,
      streamerContext: null,
      collectionDurationSeconds: 30,
      state,
      createdAt: time(-60000),
      startedAt: activated ? started : null,
      closesAt: activated ? (state === 'closed' ? time() : time(30000)) : null,
      closedAt: state === 'closed' || state === 'failed' ? time() : null,
      closeReason:
        state === 'closed' ? 'DEADLINE' : state === 'failed' ? 'PREPARATION_CANCELLED' : null,
      ruleVersion: 'collection-v1',
      preparation:
        state === 'preparing'
          ? { reason: 'capacity_wait', expiresAt: time(60000), cancelAllowed: true }
          : null,
      streamContext: activated
        ? {
            capturedAt: started,
            source: 'twitch',
            title: {
              value: 'Synthetic live stream',
              availability: 'available',
              observedAt: started,
            },
            description: absent,
            category: absent,
            game: absent,
            changedFields: [],
            changesTruncated: false,
          }
        : null,
      coverage: {
        availability: 'unavailable',
        reasonCode: 'COVERAGE_GAP',
        coveredIntervals: [],
        gapIntervals: [],
        truncated: false,
      },
      counts: { admittedSubmissions: 0, distinctSubmitters: 0 },
      analysis:
        state === 'closed'
          ? { snapshotId: ids.snapshot, snapshotVersion: 3, analysisRunId: null, state: 'empty' }
          : null,
      announcement: { state: 'not_requested', reasonCode: null },
      announcementPinMode: 'off',
      allowedActions: state === 'preparing' ? ['cancel'] : state === 'collecting' ? ['stop'] : [],
    },
  };
}
export function connectionFixture(provider = 'twitch') {
  return {
    id: ids.connection,
    version: 1,
    provider,
    grantState: 'usable',
    channels: [
      {
        id: ids.owner,
        providerChannelId: 'synthetic-channel',
        displayName: 'Synthetic stream account',
        handle: null,
        avatarUrl: null,
        ownershipVerifiedAt: '2026-10-29T12:00:00.000Z',
      },
    ],
    capabilities: Object.fromEntries(
      ['chatRead', 'chatWrite', 'liveContext', 'metrics'].map((name) => [
        name,
        { available: false, reasonCode: 'NOT_IMPLEMENTED' },
      ]),
    ),
    senderMode: 'darve_bot',
    observedAt: null,
    reauthorizationRequired: false,
  };
}
export function discoveryFixture(base = Date.now()) {
  const time = new Date(base).toISOString(),
    future = new Date(base + 60000).toISOString();
  return {
    schemaVersion: 1,
    serverTime: time,
    data: {
      items: [
        {
          id: ids.broadcast,
          connectionId: ids.connection,
          channelId: ids.owner,
          providerBroadcastId: 'synthetic-live-stream',
          providerChatId: null,
          status: 'live',
          startedAt: time,
          observedAt: time,
          chatReadiness: {
            state: 'preparing',
            reasonCode: 'COLLECTOR_NOT_STARTED',
            observedAt: time,
            freshUntil: future,
            announcement: {
              state: 'unavailable',
              reasonCode: 'BOT_UNCONFIGURED',
              observedAt: null,
              freshUntil: null,
              senderMode: 'darve_bot',
            },
          },
          liveViewers: {
            value: null,
            unit: 'viewers',
            observedAt: null,
            availability: 'unavailable',
            reasonCode: 'METRIC_UNAVAILABLE',
            source: 'twitch',
            requestedWindow: null,
            coveredIntervals: [],
          },
        },
      ],
      nextCursor: null,
      discovery: {
        state: 'live',
        reasonCode: null,
        observedAt: time,
        freshUntil: future,
        complete: true,
      },
    },
  };
}
