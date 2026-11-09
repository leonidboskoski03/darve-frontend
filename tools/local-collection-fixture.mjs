import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Node-only controlled ports around the real API/domain/SQL. No live provider or receiving claim. */
export async function createLocalCollectionFixture(
  backend,
  database,
  config,
  {
    coinActivity = false,
    allProviderIdeas = false,
    receivingReadiness,
    continuedLifecycle = false,
  } = {},
) {
  const db = await import(
    pathToFileURL(path.join(backend, 'packages/database/dist/index.js')).href
  );
  const domain = await import(
    pathToFileURL(path.join(backend, 'packages/domain/dist/index.js')).href
  );
  const cipher = config.credentialCipher;
  const readers = new Map();
  let streamChanged = false;
  let observedBroadcastId;
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
      where: { id: observedBroadcastId, connectionId: connection.id, userId: owner.userId },
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
          externalBroadcastId: streamChanged
            ? 'synthetic-changed-stream'
            : broadcast.providerBroadcastId,
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
  const fundingPort = receivingReadiness ?? {
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
  const fixture = {
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
    async collectForCoins(secret, texts, authors) {
      if (!coinActivity || config.termsPolicy?.classification !== 'development')
        throw new Error(
          'Canonical coin activity requires its explicit synthetic development fixture',
        );
      const { createIdentityAccessServices } = await import(
        pathToFileURL(path.join(backend, 'apps/api/dist/composition/identity-access.js')).href
      );
      const { sessionCsrfProof } = await import(
        pathToFileURL(path.join(backend, 'apps/api/dist/security/proofs.js')).href
      );
      const identity = createIdentityAccessServices(
        config,
        database,
        fixture.dependencies.oauthProviders,
      );
      const actor = await identity.session.access(secret, true, sessionCsrfProof(secret));
      await db.acceptTerms(database, actor.secretHash, actor.csrfHash, config.termsPolicy);
      const stream = await fixture.seed(actor.userId);
      fixture.capacity('available');
      const started = await lifecycle.start(actor, randomUUID(), {
        ...stream,
        collectionDurationSeconds: 60,
      });
      const id = started.facts.round.id;
      await lifecycle.recoverPage();
      const current = await lifecycle.status(actor.userId, id);
      if (current.facts.round.state !== 'collecting')
        throw new Error('Controlled coin collection did not start');
      await fixture.admitIdeas(actor.userId, id, texts, authors);
      await lifecycle.stop(actor, id, current.facts.round.version);
      return id;
    },
    observeReplacement(id) {
      if (!continuedLifecycle || typeof id !== 'string')
        throw new Error('Replacement observation requires the isolated continued lifecycle');
      observedBroadcastId = id;
    },
    streamChanged(value) {
      if (typeof value !== 'boolean') throw new Error('Invalid controlled stream state');
      streamChanged = value;
    },
    capacity(value) {
      if (!['busy', 'available', 'unavailable'].includes(value))
        throw new Error('Invalid fixture capacity');
      capacity = value;
    },
    funding(value) {
      if (receivingReadiness) throw Error('This fixture uses canonical receiving readiness.');
      if (!['ready', 'not_ready', 'unavailable'].includes(value))
        throw new Error('Invalid fixture funding');
      funding = value;
    },
    async seed(userId, provider = 'TWITCH') {
      if (!['TWITCH', 'YOUTUBE', 'KICK'].includes(provider))
        throw new Error('Invalid fixture provider');
      const clock = await now();
      const providerChannelId =
        allProviderIdeas && provider === 'KICK'
          ? String(randomBytes(5).readUIntBE(0, 5) + 1000)
          : allProviderIdeas && provider === 'YOUTUBE'
            ? 'UC' + randomBytes(11).toString('hex')
            : provider === 'KICK'
              ? '123'
              : randomUUID();
      const identity = await database.externalIdentity.create({
        data: {
          userId,
          provider,
          issuer: 'synthetic.invalid',
          subject: allProviderIdeas && provider === 'KICK' ? providerChannelId : randomUUID(),
        },
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
      let subscription = null;
      if (provider === 'TWITCH')
        subscription = await db.createTwitchIngestionStore(database).register(claim, {
          appId: 'a'.repeat(20),
          externalId: randomUUID(),
          socketSessionId: 'synthetic-collection-socket',
        });
      if (provider === 'YOUTUBE' && !allProviderIdeas)
        await db.createYouTubeIngestionStore(database).open(claim);
      const providerWriter =
        allProviderIdeas && provider !== 'TWITCH'
          ? await (
              await import('./local-provider-ideas-fixture.mjs')
            ).createLocalProviderIdeaWriter({
              backend,
              database,
              db,
              ingestion,
              claim,
              now,
            })
          : null;
      if (provider !== 'KICK' && !(await ingestion.healthy(claim, { kind: 'transport' })))
        throw new Error('Controlled reader health was not accepted.');
      readers.set(context.broadcastId, { context, claim, subscription, providerWriter });
      return { connectionId: connection.id, broadcastId: context.broadcastId };
    },
    async admitIdeas(
      userId,
      roundId,
      texts = ['Draw a cat', 'Draw a cat', 'Sing a short song'],
      authors,
    ) {
      if (
        authors &&
        (authors.length !== texts.length ||
          authors.some((value) => typeof value !== 'string' || !value || value.length > 256))
      )
        throw new Error('Invalid controlled viewer identities');
      const round = await database.collectionRound.findFirstOrThrow({
        where: { id: roundId, userId, state: 'collecting' },
      });
      const reader = readers.get(round.broadcastId);
      if (reader?.providerWriter && reader.context.userId === userId) {
        const repository = db.createCollectionRepository(database);
        for (const [index, text] of texts.entries()) {
          const id = await reader.providerWriter(
            '#darve ' + text,
            authors?.[index] ?? 'review-viewer-' + index,
          );
          if ((await repository.admit(userId, roundId, round.version, id)).kind !== 'admitted')
            throw new Error('Controlled provider idea was not admitted.');
        }
        return;
      }
      if (!reader?.subscription || reader.context.userId !== userId)
        throw new Error('Controlled Twitch reader is unavailable');
      const store = db.createTwitchIngestionStore(database),
        repository = db.createCollectionRepository(database);
      for (const [index, text] of texts.entries()) {
        const stamp = (await now()).toISOString(),
          providerMessageId = randomUUID();
        const result = await store.write(reader.claim, reader.subscription, {
          deliveryId: randomUUID(),
          bodyHash: 'a'.repeat(64),
          message: {
            schemaVersion: 1,
            providerMessageId,
            providerBroadcastId: null,
            providerChatId: null,
            sourceChannelId: reader.claim.providerChannelId,
            sourceMessageId: null,
            author: {
              providerAuthorId: authors?.[index] ?? 'review-viewer-' + index,
              displayName: 'Same viewer',
            },
            textOriginal: '#darve ' + text,
            kind: 'text',
            publishedAt: null,
            providerTimestamp: stamp,
            timestampKind: 'event',
            replayClassification: 'live',
            originClassification: 'selected_channel',
          },
        });
        if (result !== 'accepted') throw new Error('Controlled ingestion write was rejected');
        const source = await database.ingestedChatMessage.findFirstOrThrow({
          where: { providerMessageId },
        });
        if ((await repository.admit(userId, roundId, round.version, source.id)).kind !== 'admitted')
          throw new Error('Controlled idea was not admitted');
      }
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
  return fixture;
}
