import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Real receiving only. Checkout is never composed by this fixture. */
export async function createSellerObservation(backend, database, config, sandbox) {
  const load = (name) =>
    import(pathToFileURL(path.join(backend, `packages/${name}/dist/index.js`)).href);
  const integrations = await load('integrations');
  const counts = { observations: 0, referrals: 0 };
  if (sandbox.provider === 'paypal') {
    const provider = integrations.createPayPalReceivingProvider(config.paypalReceiving);
    return {
      counts,
      dependencies: {
        paypalReceivingProvider: {
          ...provider,
          async createReferral(trackingId, country) {
            if (country !== 'US' || counts.referrals !== 0)
              throw Error('The seller referral is outside the approved scope.');
            counts.referrals++;
            return provider.createReferral(trackingId, country);
          },
          observe(trackingId, country) {
            if (++counts.observations > 4 || country !== 'US')
              throw Error('Seller observation outside approved scope.');
            return provider.observe(trackingId, country, sandbox.saved.merchantId);
          },
        },
      },
    };
  }
  const db = await load('database');
  const provider = integrations.createStripeReceivingProvider(config.stripeReceiving);
  const saved = sandbox.saved;
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const unavailable = () => {
    throw Error('This run only observes the existing Stripe seller.');
  };
  const observe = (id, account, country) => {
    if (
      ++counts.observations > 4 ||
      id !== saved.bindingId ||
      account !== saved.accountId ||
      country !== saved.country
    )
      throw Error('Seller observation outside approved scope.');
    return provider.observe(id, account, country);
  };
  return {
    counts,
    dependencies: { stripeReceivingProvider: { create: unavailable, link: unavailable, observe } },
    async bindExisting(owner, secret, csrf) {
      if (owner !== sandbox.ownerId) throw Error('Seller fixture owner differs.');
      const session = await database.darveSession.findUniqueOrThrow({
        where: { secretHash: hash(secret) },
      });
      const { platformAccountId, platformCountry, epoch } = config.stripeReceiving;
      const repository = db.createStripeReceivingRepository(database, {
        platformAccountId,
        platformCountry,
        epoch,
      });
      const observation = await observe(saved.bindingId, saved.accountId, saved.country);
      await database.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('darve.stripe_epoch',${epoch.toLowerCase()},true)`;
        await tx.stripeReceivingBinding.create({
          data: {
            id: saved.bindingId,
            userId: owner,
            sessionId: session.id,
            platformAccountId,
            platformCountry,
            epoch,
            country: saved.country,
            keyHash: saved.keyHash,
            requestKey: saved.requestKey,
          },
        });
      });
      const proof = { secretHash: hash(secret), csrfHash: hash(csrf), terms: config.termsPolicy };
      const token = randomUUID();
      const claim = await repository.claim(owner, saved.bindingId, proof, 1, token);
      await repository.bind(owner, saved.bindingId, proof, claim.version, token, observation);
    },
  };
}
