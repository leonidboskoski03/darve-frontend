import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Human-assisted sandbox only: actual receiving/checkout ports, one reviewed contribution. */
export async function createPaymentSandboxFixture(backend, database, config, sandbox) {
  if (sandbox.provider === 'paypal')
    return (await import('./paypal-payment-sandbox.mjs')).createPayPalPaymentSandbox(
      backend,
      database,
      config,
      sandbox,
    );
  const load = (name) =>
    import(pathToFileURL(path.join(backend, `packages/${name}/dist/index.js`)).href);
  const db = await load('database'),
    domain = await load('domain'),
    integrations = await load('integrations');
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const lifetimeSeconds = 2100;
  const receivingRepository = db.createStripeReceivingRepository(database, {
    platformAccountId: sandbox.receiving.platformAccountId,
    platformCountry: sandbox.receiving.platformCountry,
    epoch: sandbox.receiving.epoch,
  });
  const receivingProvider = integrations.createStripeReceivingProvider(sandbox.receiving);
  const receiving = domain.createStripeReceivingService(
    receivingRepository,
    {
      ...receivingProvider,
      create: async () => {
        throw Error('Account creation forbidden in F06-04');
      },
    },
    config.termsPolicy,
  );
  const repository = db.createFinancialStorageRepository(database, {
    guestEpoch: sandbox.checkout.guestEpoch,
    environment: 'test',
    platformAccountIds: { stripe: sandbox.checkout.platformAccountId },
  });
  const provider = integrations.createStripeCheckoutProvider(sandbox.checkout);
  let createCalls = 0,
    challenge = null,
    heldKey = null,
    guestIssues = 0,
    resumeCalls = 0,
    verifiedReceiptReads = 0;
  const base = domain.createCheckoutService(
    repository,
    {
      ...provider,
      create: async (operation) => {
        if (++createCalls !== 1) throw Error('Sandbox create bound exhausted');
        return provider.create(operation);
      },
    },
    receiving.readiness,
    { creationEnabled: true, guestLifetimeSeconds: lifetimeSeconds },
    { create: () => randomBytes(32).toString('base64url'), hash, token: randomUUID },
  );
  const service = {
    ...base,
    async issueGuest() {
      guestIssues++;
      return base.issueGuest();
    },
    async status(id, proof) {
      const value = await base.status(id, proof);
      if (value.payments.length) verifiedReceiptReads++;
      return value;
    },
    async resume(id, proof) {
      resumeCalls++;
      return base.resume(id, proof);
    },
    async checkout(input) {
      if (
        !challenge ||
        input.publicId !== challenge.publicId ||
        input.termsVersion !== challenge.termsVersion ||
        input.paymentProvider !== 'stripe' ||
        input.amountMinor !== '1000' ||
        (heldKey && heldKey !== input.idempotencyKey)
      )
        throw new domain.FinancialStorageError('POLICY_UNAVAILABLE');
      heldKey = input.idempotencyKey;
      return base.checkout(input);
    },
  };
  return {
    dependencies: {
      checkoutGuestLifetimeSeconds: lifetimeSeconds,
      checkoutService: domain.createGuestCheckoutDispatcher(repository, service, null),
      checkoutExposure: { providers: ['stripe'], readiness: receiving.readiness },
    },
    async configure(owner, secret, csrf) {
      if (owner !== sandbox.ownerId) throw Error('Sandbox owner custody differs');
      const session = await database.darveSession.findUniqueOrThrow({
          where: { secretHash: hash(secret) },
        }),
        saved = sandbox.saved;
      const observation = await receivingProvider.observe(
        saved.bindingId,
        saved.accountId,
        saved.country,
      );
      await database.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('darve.stripe_epoch',${sandbox.receiving.epoch.toLowerCase()},true)`;
        await tx.stripeReceivingBinding.create({
          data: {
            id: saved.bindingId,
            userId: owner,
            sessionId: session.id,
            platformAccountId: sandbox.receiving.platformAccountId,
            platformCountry: sandbox.receiving.platformCountry,
            epoch: sandbox.receiving.epoch,
            country: saved.country,
            keyHash: saved.keyHash,
            requestKey: saved.requestKey,
          },
        });
      });
      const proof = { secretHash: hash(secret), csrfHash: hash(csrf), terms: config.termsPolicy },
        token = randomUUID();
      const claim = await receivingRepository.claim(owner, saved.bindingId, proof, 1, token);
      await receivingRepository.bind(
        owner,
        saved.bindingId,
        proof,
        claim.version,
        token,
        observation,
      );
      const ready = await receiving.readiness.check(owner, 'EUR');
      if (ready.state !== 'ready' || ready.ownerId !== owner || !ready.methods.includes('STRIPE'))
        throw Error('Original sandbox recipient is not ready for EUR');
      await repository.setAgreement(owner, 0, {
        version: 'f06-04-synthetic-test-only',
        currencies: {
          EUR: {
            minimumMinor: '1000',
            maximumMinor: '1000',
            darveFee: {
              type: 'percentage_plus_flat',
              basisPoints: 200,
              rounding: 'floor',
              amountMinor: '50',
            },
          },
        },
      });
    },
    async bindChallenge(id) {
      const value = await database.acceptedChallenge.findUniqueOrThrow({ where: { id } }),
        link = await database.challengePublicLink.findUniqueOrThrow({ where: { challengeId: id } });
      if (value.userId !== sandbox.ownerId || value.currency !== 'EUR')
        throw Error('Sandbox challenge context differs');
      challenge = { id, publicId: link.publicId, termsVersion: value.termsId };
      return { publicId: link.publicId };
    },
    async audit() {
      const attempts = await database.paymentCheckoutAttempt.findMany({
        select: { state: true, amountMinor: true, darveFeeMinor: true, currency: true },
      });
      const payments = await database.financialPayment.findMany({
        select: { amountMinor: true, currency: true },
      });
      return {
        guestIssues,
        resumeCalls,
        verifiedReceiptReads,
        actualSandboxProvider: 'stripe',
        accountCreationCalls: 0,
        providerCreateCalls: createCalls,
        attemptCount: attempts.length,
        paymentCount: payments.length,
        expectedAmountAndFee: attempts.every(
          (row) =>
            row.amountMinor.toString() === '1000' &&
            row.darveFeeMinor.toString() === '70' &&
            row.currency === 'EUR',
        ),
        expectedPaymentAmount: payments.every(
          (row) => row.amountMinor.toString() === '1000' && row.currency === 'EUR',
        ),
        states: attempts.map((row) => row.state),
      };
    },
  };
}
