import {
  constants,
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Node-only F10 inputs through actual provider storage. No external request or HTTP fixture route. */
export async function createLocalProviderIdeaWriter({
  backend,
  database,
  db,
  ingestion,
  claim,
  now,
}) {
  if (claim.provider === 'YOUTUBE') {
    const store = db.createYouTubeIngestionStore(database);
    let cursor = await store.open(claim);
    return async (text, author) => {
      const stamp = (await now()).toISOString(),
        providerMessageId = randomUUID();
      const result = await store.write(claim, {
        expectedRevision: cursor.revision,
        mode: 'STREAMING',
        requestedPageToken: cursor.pageToken,
        nextPageToken: randomUUID(),
        connectionStartedAt: cursor.connectionStartedAt,
        items: [
          {
            schemaVersion: 1,
            providerMessageId,
            providerBroadcastId: claim.providerBroadcastId,
            providerChatId: claim.providerChatId,
            sourceChannelId: claim.providerChannelId,
            sourceMessageId: null,
            author: {
              providerAuthorId:
                'UC' + createHash('sha256').update(author).digest('hex').slice(0, 22),
              displayName: 'Same viewer',
            },
            textOriginal: text,
            kind: 'text',
            publishedAt: stamp,
            providerTimestamp: stamp,
            timestampKind: 'published',
            replayClassification: 'live',
            originClassification: 'selected_channel',
          },
        ],
        activePollItem: null,
        offlineAt: null,
        pollingIntervalMs: null,
      });
      if (result.result !== 'accepted') throw Error('Controlled YouTube batch was rejected.');
      cursor = await store.open(claim);
      return (await database.youTubeChatMessage.findFirstOrThrow({ where: { providerMessageId } }))
        .id;
    };
  }
  if (claim.provider !== 'KICK') throw Error('This writer requires YouTube or Kick.');
  const integrations = await import(
    pathToFileURL(path.join(backend, 'packages/integrations/dist/index.js')).href
  );
  const appId = 'synthetic-f10-kick-app',
    store = db.createKickReaderStore(database, appId);
  const ulid = () => '01' + randomBytes(12).toString('hex').toUpperCase();
  const subscriptionId = ulid(),
    intent = await store.reserve(claim);
  await store.beginCreate(claim, intent.ticket);
  await store.receipt(intent.ticket, subscriptionId);
  await store.verifyResource(claim, intent.ticket, {
    id: subscriptionId,
    appId,
    recipientId: claim.providerChannelId,
    event: 'chat.message.sent',
    version: 1,
    method: 'webhook',
    createdAt: (await now()).toISOString(),
  });
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const verify = integrations.createKickWebhookVerifier({
    fetch: async () =>
      new Response(
        JSON.stringify({
          data: { public_key: keys.publicKey.export({ type: 'spki', format: 'pem' }) },
        }),
      ),
  });
  const write = async (text, author) => {
    const stamp = (await now()).toISOString(),
      providerMessageId = randomUUID(),
      deliveryId = ulid();
    const user = {
      is_anonymous: false,
      user_id: Number(claim.providerChannelId),
      username: 'Synthetic collection channel',
      is_verified: false,
      profile_picture: null,
      channel_slug: 'synthetic',
      identity: null,
    };
    const body = Buffer.from(
      JSON.stringify({
        message_id: providerMessageId,
        broadcaster: user,
        sender: {
          ...user,
          user_id: parseInt(createHash('sha256').update(author).digest('hex').slice(0, 12), 16) + 1,
          username: 'Same viewer',
        },
        content: text,
        created_at: stamp,
        emotes: [],
        replies_to: null,
      }),
    );
    const rawHeaders = Object.entries({
      'Kick-Event-Message-Id': deliveryId,
      'Kick-Event-Subscription-Id': subscriptionId,
      'Kick-Event-Message-Timestamp': stamp,
      'Kick-Event-Type': 'chat.message.sent',
      'Kick-Event-Version': '1',
      'Kick-Event-Signature': sign(
        'sha256',
        Buffer.concat([Buffer.from(`${deliveryId}.${stamp}.`), body]),
        {
          key: keys.privateKey,
          padding: constants.RSA_PKCS1_PADDING,
        },
      ).toString('base64'),
    }).flat();
    const event = await verify(rawHeaders, body);
    if ((await db.createKickIngressStore(database, appId).accept(event)) !== 'accepted')
      throw Error('Controlled signed Kick delivery was rejected.');
    const [work] = await store.claimWork(claim, 1);
    if (
      !work ||
      (await store.commit(
        claim,
        work,
        integrations.normalizeKickChat(work.body, claim.providerChannelId, work.signedTimestamp),
      )) !== 'accepted'
    )
      throw Error('Controlled Kick consumer did not commit.');
    if (!(await ingestion.healthy(claim, { kind: 'delivery', inboxId: work.inboxId })))
      throw Error('Controlled Kick delivery health was rejected.');
    return (await database.ingestedChatMessage.findFirstOrThrow({ where: { providerMessageId } }))
      .id;
  };
  // Kick readiness needs observed delivery; this non-command precedes the collection window.
  await write('Synthetic reader readiness observation', 'synthetic-readiness');
  return write;
}
