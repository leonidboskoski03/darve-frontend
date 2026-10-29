import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
/** Node-only synthetic verified-provider facts through the actual financial repositories. */
export async function createLocalReportingFixture(backend, database) {
  const db = await import(
    pathToFileURL(path.join(backend, 'packages/database/dist/index.js')).href
  );
  const settings = {
    guestEpoch: randomUUID(),
    environment: 'test',
    platformAccountIds: {
      stripe: 'acct_reporting_synthetic',
      paypal: 'merchant_reporting_synthetic',
    },
  };
  const repository = db.createFinancialStorageRepository(database, settings);
  const accounts = new Map();
  const now = async () =>
    (await database.$queryRaw`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`)[0].now;
  return {
    async fund(challengeId) {
      const challenge = await database.acceptedChallenge.findUniqueOrThrow({
          where: { id: challengeId },
        }),
        owner = challenge.userId,
        currency = challenge.currency;
      const revision =
        (
          await database.paymentAgreement.findFirst({
            where: { userId: owner },
            orderBy: { revision: 'desc' },
          })
        )?.revision ?? 0;
      await repository.setAgreement(owner, revision, {
        version: 'synthetic-reporting-v1',
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
      if (!accounts.has(owner)) accounts.set(owner, 'account_' + randomUUID());
      const recipient = await repository.bindRecipient({
        owner,
        paymentProvider: 'stripe',
        environment: 'test',
        platformAccountId: settings.platformAccountIds.stripe,
        accountId: accounts.get(owner),
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
      const secretHash = createHash('sha256').update(randomUUID()).digest('hex');
      await repository.issueGuestAccess(secretHash, new Date(observedAt.getTime() + 3600000));
      const link = await database.challengePublicLink.findUniqueOrThrow({ where: { challengeId } });
      const prepared = await repository.prepareCheckout({
        publicId: link.publicId,
        termsVersion: challenge.termsId,
        paymentProvider: 'stripe',
        amountMinor: challenge.goalMinor.toString(),
        idempotencyKey: randomUUID(),
        secretHash,
      });
      const attempt = await database.paymentCheckoutAttempt.findUniqueOrThrow({
        where: { id: prepared.checkout.id },
      });
      await repository.recordVerifiedSuccess({
        attemptId: attempt.id,
        paymentProvider: 'stripe',
        environment: 'test',
        platformAccountId: attempt.platformAccountId,
        accountId: attempt.accountId,
        checkoutObjectId: 'object_' + attempt.id,
        monetaryObjectId: 'money_' + attempt.id,
        eventId: 'event_' + randomUUID(),
        amountMinor: attempt.amountMinor.toString(),
        currency: attempt.currency,
        darveFeeMinor: attempt.darveFeeMinor.toString(),
        paidAt: await now(),
      });
    },
    declarationCount(userId) {
      return database.challengeCompletionDeclaration.count({ where: { userId } });
    },
  };
}
