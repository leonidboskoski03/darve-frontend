import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Node-only existing-receipt facts. Ordinary and injected HTTP creation remain disabled. */
export async function createLocalContributionFixture(backend, database) {
  const db = await import(
    pathToFileURL(path.join(backend, 'packages/database/dist/index.js')).href
  );
  const domain = await import(
    pathToFileURL(path.join(backend, 'packages/domain/dist/index.js')).href
  );
  const repository = db.createFinancialStorageRepository(database, {
    guestEpoch: randomUUID(),
    environment: 'test',
    platformAccountIds: { stripe: 'acct_contribution_synthetic' },
  });
  const now = async () =>
    (await database.$queryRaw`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`)[0].now;
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  let providerReads = 0;
  const provider = {
    validate() {},
    create() {
      throw new Error('Read fixture cannot create external payments');
    },
    verify() {
      return null;
    },
    retrieveNotification() {
      throw new Error('No external webhook in read acceptance');
    },
    async retrieve(_operation, id) {
      providerReads++;
      return { id, url: null, success: null, paymentIntentId: null };
    },
  };
  const service = domain.createCheckoutService(
    repository,
    provider,
    { check: async () => ({ state: 'not_ready' }) },
    { creationEnabled: false, guestLifetimeSeconds: 600 },
    { create: () => randomBytes(32).toString('base64url'), hash: digest, token: randomUUID },
  );
  return {
    dependencies: {
      checkoutService: domain.createGuestCheckoutDispatcher(repository, service, null),
    },
    async seed(
      challengeId,
      { amountMinor = '1007', lifetimeMs = 600000, state = 'awaiting' } = {},
    ) {
      const challenge = await database.acceptedChallenge.findUniqueOrThrow({
        where: { id: challengeId },
      });
      const owner = challenge.userId,
        currency = challenge.currency;
      const revision =
        (
          await database.paymentAgreement.findFirst({
            where: { userId: owner },
            orderBy: { revision: 'desc' },
          })
        )?.revision ?? 0;
      await repository.setAgreement(owner, revision, {
        version: 'synthetic-read-v1',
        currencies: {
          [currency]: {
            minimumMinor: '1',
            maximumMinor: '9223372036854775807',
            darveFee: {
              type: 'percentage_plus_flat',
              basisPoints: 200,
              rounding: 'floor',
              amountMinor: '50',
            },
          },
        },
      });
      const recipient = await repository.bindRecipient({
        owner,
        paymentProvider: 'stripe',
        environment: 'test',
        platformAccountId: 'acct_contribution_synthetic',
        accountId: 'recipient_' + owner,
        country: 'SG',
      });
      const observedAt = await now();
      await repository.observeRecipient({
        id: recipient.id,
        expectedVersion: recipient.version,
        observedAt,
        validUntil: new Date(observedAt.getTime() + 120000),
        currencies: ['EUR', 'USD'],
        chargesEnabled: true,
        payoutsEnabled: true,
        capabilityActive: true,
      });
      const secret = randomBytes(32).toString('base64url'),
        secretHash = digest(secret);
      await repository.issueGuestAccess(secretHash, new Date(observedAt.getTime() + lifetimeMs));
      const link = await database.challengePublicLink.findUniqueOrThrow({ where: { challengeId } });
      const result = await repository.prepareCheckout({
        publicId: link.publicId,
        termsVersion: challenge.termsId,
        paymentProvider: 'stripe',
        amountMinor,
        idempotencyKey: randomUUID(),
        secretHash,
      });
      const id = result.checkout.id,
        token = randomUUID();
      await repository.claimOperation(id, token, 30, 'create');
      await repository.finishOperation(id, token, {
        state,
        externalObjectId: state === 'awaiting' ? 'synthetic_object_' + id : null,
      });
      return { id, publicId: link.publicId, secret, secretHash };
    },
    async settle(id, paidAt = null) {
      const attempt = await database.paymentCheckoutAttempt.findUniqueOrThrow({ where: { id } });
      await repository.recordVerifiedSuccess({
        attemptId: id,
        paymentProvider: 'stripe',
        environment: 'test',
        platformAccountId: attempt.platformAccountId,
        accountId: attempt.accountId,
        checkoutObjectId: attempt.externalObjectId ?? 'synthetic_object_' + id,
        monetaryObjectId: 'synthetic_money_' + id,
        eventId: 'synthetic_event_' + id,
        amountMinor: attempt.amountMinor.toString(),
        currency: attempt.currency,
        darveFeeMinor: attempt.darveFeeMinor.toString(),
        paidAt: paidAt === 'now' ? await now() : paidAt,
      });
    },
    revoke: (secretHash) => repository.revokeGuestAccess({ secretHash }),
    async audit() {
      return {
        attempts: await database.paymentCheckoutAttempt.count(),
        payments: await database.financialPayment.count(),
        providerReads,
      };
    },
  };
}
