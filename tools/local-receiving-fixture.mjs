import { randomBytes, randomUUID } from 'node:crypto';

/** Controlled provider ports for the disposable F03-04 runtime. */
export function localReceivingFixture(origin, apiOrigin) {
  const returnUrl = origin + '/integrations';
  const callback = apiOrigin + '/api/payment-accounts/stripe/oauth/callback';
  const counts = { stripeCreates: 0, paypalReferrals: 0, stripeExchanges: 0 };
  const stripeObservation = (accountId, country) => ({
    accountId,
    country,
    currencies: ['USD', 'EUR'],
    chargesEnabled: true,
    payoutsEnabled: true,
    capabilityActive: true,
  });
  const paypalLink =
    'https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=synthetic';
  return {
    counts,
    environment: {
      STRIPE_TEST_SECRET_KEY: 'sk_test_' + 'synthetic'.repeat(4),
      STRIPE_PLATFORM_ACCOUNT_ID: 'acct_platformsynthetic',
      STRIPE_PLATFORM_COUNTRY: 'SG',
      STRIPE_BINDING_EPOCH: randomUUID(),
      STRIPE_ONBOARDING_RETURN_URL: returnUrl,
      STRIPE_ONBOARDING_REFRESH_URL: returnUrl,
      STRIPE_OAUTH_TEST_CLIENT_ID: 'ca_syntheticexisting',
      STRIPE_OAUTH_REDIRECT_URL: callback,
      PAYPAL_SANDBOX_CLIENT_ID: 'synthetic-paypal-client',
      PAYPAL_SANDBOX_CLIENT_SECRET: 'synthetic-paypal-secret',
      PAYPAL_SANDBOX_APP_ID: 'APP-SYNTHETIC0001',
      PAYPAL_PARTNER_MERCHANT_ID: 'PLATFORM00001',
      PAYPAL_PARTNER_ATTRIBUTION_ID: 'Darve_Sandbox',
      PAYPAL_BINDING_EPOCH: randomUUID(),
      PAYPAL_ONBOARDING_RETURN_URL: returnUrl,
      CREDENTIAL_ENCRYPTION_KEY_ID: 'f03-receiving-test',
      CREDENTIAL_ENCRYPTION_KEY_BASE64: randomBytes(32).toString('base64'),
    },
    dependencies: {
      stripeReceivingProvider: {
        async create(id, country) {
          counts.stripeCreates++;
          if (country === 'CA') throw Error('Controlled uncertain Stripe creation.');
          return stripeObservation('acct_' + id.replaceAll('-', ''), country);
        },
        async observe(_id, accountId, country) {
          return stripeObservation(accountId, country);
        },
        async link(_id, accountId, country) {
          return {
            url: 'https://connect.stripe.com/r/synthetic#opaque',
            expiresAt: new Date(Date.now() + 600_000),
            observation: stripeObservation(accountId, country),
          };
        },
      },
      stripeExistingAccountProvider: {
        authorizationUrl(state) {
          return (
            'https://connect.stripe.com/oauth/authorize?' +
            new URLSearchParams({ state, redirect_uri: callback }).toString()
          );
        },
        async exchange() {
          counts.stripeExchanges++;
          return { accountId: 'acct_existing' + randomBytes(12).toString('hex') };
        },
        async observe(accountId, country) {
          return stripeObservation(accountId, country);
        },
      },
      paypalReceivingProvider: {
        async createReferral() {
          counts.paypalReferrals++;
          return { referralId: 'synthetic-private-referral', url: paypalLink };
        },
        async referralLink() {
          return paypalLink;
        },
        async observe(trackingId, country) {
          return {
            merchantId: 'MERCHANT00001',
            trackingId,
            country,
            currencies: ['EUR'],
            paymentsReceivable: true,
            emailConfirmed: true,
            walletActive: true,
            cardsActive: false,
            partnerFeeGranted: true,
          };
        },
      },
    },
  };
}
