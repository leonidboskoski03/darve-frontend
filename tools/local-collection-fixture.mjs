import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Node-only controlled ports around the real API/domain/SQL. No live provider or receiving claim. */
export async function createLocalCollectionFixture(backend, database, config) {
  const db = await import(
    pathToFileURL(path.join(backend, 'packages/database/dist/index.js')).href
  );
  const domain = await import(
    pathToFileURL(path.join(backend, 'packages/domain/dist/index.js')).href
  );
  const cipher = config.credentialCipher;
  let capacity = 'busy',
    funding = 'ready';
  const now = async () =>
    (await database.$queryRaw`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`)[0].now;
  const discover = async (owner) => {
    const connection = await database.providerConnection.findFirstOrThrow({
      where: { id: owner.connectionId, userId: owner.userId },
      include: { identity: true, channels: true },
    });
    const broadcast = await database.broadcast.findFirstOrThrow({
      where: { connectionId: connection.id, userId: owner.userId },
    });
    return {
      kind: 'observed',
      connection: {
        userId: owner.userId,
        connectionId: connection.id,
        provider: connection.provider,
        identityId: connection.identityId,
        issuer: connection.identity.issuer,
        subject: connection.identity.subject,
        credentialVersion: connection.credentialVersion,
        active: true,
        inactiveReason: null,
        channels: connection.channels.map((channel) => ({
          id: channel.id,
          providerChannelId: channel.providerChannelId,
        })),
      },
      observation: {
        channel: {
          providerChannelId: broadcast.providerChannelId,
          login: null,
          displayName: 'Synthetic collection channel',
          avatarUrl: null,
        },
        observedAt: await now(),
        status: 'live',
        broadcast: {
          externalBroadcastId: broadcast.providerBroadcastId,
          externalChatId: broadcast.providerChatId,
          title: 'Synthetic provider observation',
          description: null,
          categoryId: null,
          categoryName: null,
          startedAt: broadcast.startedAt,
        },
        liveViewers: {
          value: null,
          observedAt: null,
          source: connection.provider,
          availability: 'unavailable',
          reasonCode: 'METRIC_UNAVAILABLE',
        },
      },
    };
  };
  const unavailable = () => {
    throw new Error('OAuth is not available in the collection fixture.');
  };
  const capacityPort = { admit: async () => capacity };
  const fundingPort = {
    check: async (ownerId) =>
      funding === 'ready' ? { state: 'ready', ownerId, methods: ['STRIPE'] } : { state: funding },
  };
  const { createCollectionServices } = await import(
    pathToFileURL(path.join(backend, 'apps/api/dist/composition/collection.js')).href
  );
  const lifecycle = createCollectionServices(
    database,
    config,
    { discover },
    capacityPort,
    fundingPort,
  );
  return {
    dependencies: {
      oauthProviders: Object.fromEntries(
        ['TWITCH', 'YOUTUBE', 'KICK'].map((provider) => [
          provider,
          { provider, authorizationUrl: unavailable, exchange: unavailable },
        ]),
      ),
      streamDiscovery: { discover },
      collectionCapacity: capacityPort,
      fundingReadiness: fundingPort,
    },
    recover: () => lifecycle.recoverPage(),
    capacity(value) {
      if (!['busy', 'available', 'unavailable'].includes(value))
        throw new Error('Invalid fixture capacity');
      capacity = value;
    },
    funding(value) {
      if (!['ready', 'not_ready', 'unavailable'].includes(value))
        throw new Error('Invalid fixture funding');
      funding = value;
    },
    async seed(userId, provider = 'TWITCH') {
      if (!['TWITCH', 'YOUTUBE', 'KICK'].includes(provider))
        throw new Error('Invalid fixture provider');
      const clock = await now();
      const providerChannelId = provider === 'KICK' ? '123' : randomUUID();
      const identity = await database.externalIdentity.create({
        data: { userId, provider, issuer: 'synthetic.invalid', subject: randomUUID() },
      });
      const connection = await database.providerConnection.create({
        data: { userId, provider, identityId: identity.id },
      });
      const channel = await database.ownedChannel.create({
        data: {
          userId,
          provider,
          connectionId: connection.id,
          providerChannelId,
          displayName: 'Synthetic collection channel',
          verifiedAt: clock,
        },
      });
      const context = {
        userId,
        provider,
        connectionId: connection.id,
        channelId: channel.id,
        broadcastId: randomUUID(),
      };
      await db.createCredentialStore(database, cipher).saveGrant(context, 0, {
        accessToken: 'synthetic-collection-private',
        scopes: domain.creatorAuthorizationScopes(provider, 'streaming'),
        expiresAt: new Date(clock.getTime() + 3600000),
      });
      const providerBroadcastId = randomUUID();
      const startedAt = new Date(clock.getTime() - 10000);
      const incarnationKey = createHash('sha256')
        .update(
          JSON.stringify([
            provider,
            providerChannelId,
            providerBroadcastId,
            startedAt.toISOString(),
          ]),
        )
        .digest('hex');
      await database.broadcast.create({
        data: {
          id: context.broadcastId,
          userId,
          provider,
          connectionId: connection.id,
          channelId: channel.id,
          providerChannelId,
          providerBroadcastId,
          providerChatId: provider === 'YOUTUBE' ? 'synthetic-chat' : null,
          incarnationKey,
          status: 'LIVE',
          startedAt,
          observedAt: clock,
        },
      });
      const ingestion = db.createIngestionRepository(database, {
        leaseMs: 60000,
        retryMs: 1000,
        contextFreshnessMs: 30000,
      });
      await ingestion.request(context, 1);
      const claims = await ingestion.claim(randomUUID(), [provider], 100);
      const claim = claims.find(
        (value) =>
          value.connectionId === context.connectionId && value.broadcastId === context.broadcastId,
      );
      if (!claim || !(await ingestion.activate(claim, 1)))
        throw new Error('Controlled reader could not be activated');
      if (provider === 'TWITCH')
        await db.createTwitchIngestionStore(database).register(claim, {
          appId: 'a'.repeat(20),
          externalId: randomUUID(),
          socketSessionId: 'synthetic-collection-socket',
        });
      if (provider === 'YOUTUBE') await db.createYouTubeIngestionStore(database).open(claim);
      if (provider !== 'KICK' && !(await ingestion.healthy(claim, { kind: 'transport' })))
        throw new Error('Controlled reader health was not accepted.');
      return { connectionId: connection.id, broadcastId: context.broadcastId };
    },
    async roundState(id) {
      const round = await database.collectionRound.findUniqueOrThrow({ where: { id } });
      return {
        state: round.state,
        version: round.version,
        snapshotCount: await database.analysisSnapshot.count({ where: { roundId: id } }),
      };
    },
    async debugRound(userId, id) {
      const facts = await db.createCollectionLifecycleRepository(database).read(userId, id);
      return {
        state: facts.round.state,
        preparationReason: facts.round.preparationReason,
        readiness: facts.readiness,
        contextStatus: facts.status,
        contextObservedAt: facts.contextObservedAt,
        contextFreshUntil: facts.contextFreshUntil,
        now: facts.now,
        credentialVersion: facts.credentialVersion,
      };
    },
    async roundCount(userId) {
      return database.collectionRound.count({ where: { userId } });
    },
  };
}
