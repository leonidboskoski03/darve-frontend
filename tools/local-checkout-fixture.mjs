import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Node-only controlled provider ports, real services/repositories/SQL. No external payment. */
export async function createLocalCheckoutFixture(backend, database, config) {
  const load = (name) =>
    import(pathToFileURL(path.join(backend, `packages/${name}/dist/index.js`)).href);
  const db = await load('database'),
    domain = await load('domain');
  const scope = {
    clientId: 'synthetic-checkout-client',
    appId: 'APP-SYNTHETIC0001',
    partnerMerchantId: 'PLATFORM00001',
    epoch: randomUUID(),
  };
  const repository = db.createFinancialStorageRepository(database, {
    guestEpoch: randomUUID(),
    environment: 'test',
    platformAccountIds: { stripe: 'acct_checkoutsynth', paypal: scope.partnerMerchantId },
    paypalScope: scope,
  });
  const stripeObservation = (accountId, country) => ({
    accountId,
    country,
    currencies: ['EUR', 'USD'],
    chargesEnabled: true,
    payoutsEnabled: true,
    capabilityActive: true,
  });
  const stripeReceiving = domain.createStripeReceivingService(
    db.createStripeReceivingRepository(database, {
      platformAccountId: 'acct_checkoutsynth',
      platformCountry: 'SG',
      epoch: randomUUID(),
    }),
    {
      create: async (id, country) =>
        stripeObservation('acct_synthetic' + id.replaceAll('-', ''), country),
      observe: async (_id, accountId, country) => stripeObservation(accountId, country),
      link: async (_id, accountId, country) => ({
        url: 'https://connect.stripe.com/synthetic',
        expiresAt: new Date(Date.now() + 60000),
        observation: stripeObservation(accountId, country),
      }),
    },
    config.termsPolicy,
  );
  const receiving = domain.createPayPalReceivingService(
    db.createPayPalReceivingRepository(database, scope, config.credentialCipher),
    {
      createReferral: async () => ({
        referralId: 'synthetic-referral',
        url: 'https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=synthetic-referral',
      }),
      referralLink: async () =>
        'https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=synthetic-referral',
      observe: async (trackingId, country) => ({
        merchantId: 'SELLER0000001',
        trackingId,
        country,
        currencies: ['EUR'],
        paymentsReceivable: true,
        emailConfirmed: true,
        walletActive: true,
        cardsActive: false,
        partnerFeeGranted: true,
      }),
    },
    config.termsPolicy,
  );
  let enabled = true,
    uncertainCreate = false,
    captureUnknown = false;
  const owners = new Set(),
    objects = new Map();
  const counts = { stripeCreates: 0, paypalCreates: 0, retrieves: 0, captures: 0 };
  const readiness = {
    async check(ownerId, currency) {
      if (!enabled || !owners.has(ownerId)) return { state: 'not_ready' };
      const [stripe, paypal] = await Promise.all([
        stripeReceiving.readiness.check(ownerId, currency),
        receiving.readiness.check(ownerId, currency),
      ]);
      const methods = [
        ...(stripe.state === 'ready' ? ['STRIPE'] : []),
        ...(paypal.state === 'ready' ? ['PAYPAL'] : []),
      ];
      if (!methods.length) return { state: 'not_ready' };
      return {
        state: 'ready',
        ownerId,
        methods,
      };
    },
  };
  const stripe = {
    validate() {},
    verify() {
      return null;
    },
    retrieveNotification() {
      throw new Error('No external notification fixture');
    },
    async create(operation) {
      counts.stripeCreates++;
      if (uncertainCreate) {
        uncertainCreate = false;
        throw new Error('Synthetic unconfirmed provider outcome');
      }
      const id = 'cs_test_' + operation.id.replaceAll('-', '');
      const result = {
        id,
        url: 'https://checkout.stripe.com/c/pay/' + id,
        success: null,
        paymentIntentId: null,
      };
      objects.set(id, result);
      return result;
    },
    async retrieve(_operation, id) {
      counts.retrieves++;
      const result = objects.get(id);
      if (!result) throw new Error('Unknown synthetic object');
      return result;
    },
  };
  const paypal = {
    validate() {},
    async create() {
      counts.paypalCreates++;
      const id = 'ORDER' + counts.paypalCreates;
      const result = {
        id,
        state: 'created',
        approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=' + id,
        success: null,
      };
      objects.set(id, result);
      return result;
    },
    async retrieve(_operation, id) {
      counts.retrieves++;
      const result = objects.get(id);
      if (!result) throw new Error('Unknown synthetic order');
      return result;
    },
    async capture(operation, id) {
      counts.captures++;
      if (captureUnknown) {
        captureUnknown = false;
        throw new Error('Synthetic unknown capture');
      }
      const result = {
        id,
        state: 'completed',
        approvalUrl: null,
        success: {
          attemptId: operation.id,
          paymentProvider: 'paypal',
          environment: 'test',
          platformAccountId: operation.platformAccountId,
          accountId: operation.accountId,
          checkoutObjectId: id,
          monetaryObjectId: 'CAPTURE' + counts.captures,
          amountMinor: operation.amountMinor,
          currency: operation.currency,
          darveFeeMinor: operation.darveFeeMinor,
          paidAt: new Date(),
        },
      };
      objects.set(id, result);
      return result;
    },
  };
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const proofs = { create: () => randomBytes(32).toString('base64url'), hash, token: randomUUID };
  const options = { creationEnabled: true, guestLifetimeSeconds: 600 };
  const stripeService = domain.createCheckoutService(
    repository,
    stripe,
    readiness,
    options,
    proofs,
  );
  const paypalService = domain.createPayPalCheckoutService(
    repository,
    paypal,
    readiness,
    options,
    proofs,
  );
  return {
    dependencies: {
      checkoutGuestLifetimeSeconds: options.guestLifetimeSeconds,
      checkoutService: domain.createGuestCheckoutDispatcher(
        repository,
        stripeService,
        paypalService,
      ),
      checkoutExposure: { providers: ['stripe', 'paypal'], readiness },
    },
    async configure(owner, secret, csrf) {
      await repository.setAgreement(owner, 0, {
        version: 'synthetic-checkout-v1',
        currencies: {
          EUR: {
            minimumMinor: '100',
            maximumMinor: '100000',
            darveFee: {
              type: 'percentage_plus_flat',
              basisPoints: 200,
              rounding: 'floor',
              amountMinor: '50',
            },
          },
        },
      });
      const actor = { userId: owner, secretHash: hash(secret), csrfHash: hash(csrf) };
      await stripeReceiving.onboarding(actor, randomUUID(), 'SG');
      await receiving.onboarding(actor, randomUUID(), 'US', true);
      await receiving.refresh(actor);
      owners.add(owner);
    },
    receiving: (value) => {
      enabled = value;
    },
    unknownCreate: () => {
      uncertainCreate = true;
    },
    unknownCapture: () => {
      captureUnknown = true;
    },
    async approve(id) {
      const context = await repository.checkoutContext(id);
      const object = objects.get(context.externalObjectId);
      if (!object) throw new Error('No synthetic order');
      objects.set(context.externalObjectId, { ...object, state: 'approved', approvalUrl: null });
    },
    async revokeBrowser(secret) {
      await repository.revokeGuestAccess({ secretHash: hash(secret) });
    },
    async expireBrowser(secret) {
      await database.paymentGuestAccess.updateMany({
        where: { secretHash: hash(secret) },
        data: { expiresAt: new Date(0) },
      });
    },
    async withdrawSource(challengeId) {
      const challenge = await database.acceptedChallenge.findUniqueOrThrow({
        where: { id: challengeId },
      });
      await database.providerConnection.update({
        where: { id: challenge.connectionId },
        data: { unlinkedAt: new Date() },
      });
    },
    async audit() {
      return {
        ...counts,
        attempts: await database.paymentCheckoutAttempt.count(),
        payments: await database.financialPayment.count(),
      };
    },
  };
}
