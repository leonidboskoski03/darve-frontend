import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';

export function assertPaymentSandboxSelection({
  task,
  port,
  origins,
  sandboxPayment,
  collection,
  review,
  checkout,
  contributionReads,
  reporting,
  operatorOAuth,
  overlay = false,
  terms = false,
  qrPublicOrigin,
}) {
  const funded = task === 'f10-03-sandbox';
  if (!sandboxPayment && task !== 'f06-04' && !funded) return;
  if (
    (task !== 'f06-04' && !funded) ||
    sandboxPayment?.approval !== (funded ? 'F10-03' : 'F06-04') ||
    !['stripe', 'paypal'].includes(sandboxPayment.provider) ||
    typeof sandboxPayment.sourceRoot !== 'string' ||
    !collection ||
    !review ||
    checkout ||
    contributionReads ||
    reporting ||
    operatorOAuth !== undefined ||
    overlay !== funded ||
    (funded && terms !== true) ||
    qrPublicOrigin !== undefined ||
    port !== 3310 ||
    origins.length !== 1 ||
    origins[0] !== 'http://127.0.0.1:4175'
  )
    throw new Error(
      'Payment sandbox requires explicit task approval, one supported provider and its exact isolated composition.',
    );
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
/** Select secrets in RAM; never merge them into ordinary environment or result metadata. */
export async function readPaymentSandboxConfiguration(backend, input) {
  const integrations = await import(
    pathToFileURL(path.join(backend, 'packages/integrations/dist/index.js')).href
  );
  const sourceRoot = path.resolve(input.sourceRoot);
  if (input.provider === 'paypal') {
    const raw = parseEnv(
      readFileSync(path.join(sourceRoot, '.env.paypal-sandbox'), 'utf8').replace(/^\uFEFF/, ''),
    );
    const selected = Object.fromEntries(
      [
        'PAYPAL_SANDBOX_CLIENT_ID',
        'PAYPAL_SANDBOX_CLIENT_SECRET',
        'PAYPAL_SANDBOX_APP_ID',
        'PAYPAL_PARTNER_MERCHANT_ID',
        'PAYPAL_PARTNER_ATTRIBUTION_ID',
        'PAYPAL_BINDING_EPOCH',
        'PAYPAL_RECEIVING_TIMEOUT_MS',
        'PAYMENT_GUEST_EPOCH',
        'PAYMENT_GUEST_LIFETIME_SECONDS',
        'CREDENTIAL_ENCRYPTION_KEY_ID',
        'CREDENTIAL_ENCRYPTION_KEY_BASE64',
      ].map((key) => [key, raw[key]]),
    );
    selected.PAYPAL_ONBOARDING_RETURN_URL = 'http://127.0.0.1:4175/sandbox/setup';
    selected.PAYPAL_CHECKOUT_RETURN_URL = 'http://127.0.0.1:4175/payments/return';
    selected.PAYPAL_CHECKOUT_CANCEL_URL = 'http://127.0.0.1:4175/payments/cancel';
    const receiving = integrations.readPayPalReceivingConfiguration(selected, 'test'),
      checkout = integrations.readPayPalCheckoutConfiguration(selected, 'test'),
      cipher = integrations.readCredentialCipher(selected);
    const saved = z
      .object({
        ownerId: z.uuid(),
        merchantId: z.string().regex(/^[A-Z0-9]{13}$/),
        state: z.literal('bound'),
        automaticRecreationAllowed: z.literal(false),
      })
      .parse(
        JSON.parse(
          readFileSync(
            path.join(sourceRoot, 'test-results/b08-sandbox-binding-checkpoint.json'),
            'utf8',
          ),
        ),
      );
    if (
      !receiving ||
      !checkout ||
      !cipher ||
      saved.merchantId !== raw.PAYPAL_SANDBOX_SELLER_MERCHANT_ID
    )
      throw new Error('Existing PayPal sandbox seller custody required.');
    return { provider: 'paypal', ownerId: saved.ownerId, receiving, checkout, cipher, saved };
  }
  const raw = parseEnv(
    readFileSync(path.join(sourceRoot, '.env.stripe-sandbox'), 'utf8').replace(/^\uFEFF/, ''),
  );
  const selected = Object.fromEntries(
    [
      'STRIPE_TEST_SECRET_KEY',
      'STRIPE_PLATFORM_ACCOUNT_ID',
      'STRIPE_PLATFORM_COUNTRY',
      'STRIPE_BINDING_EPOCH',
      'STRIPE_RECEIVING_TIMEOUT_MS',
      'STRIPE_ONBOARDING_RETURN_URL',
      'STRIPE_ONBOARDING_REFRESH_URL',
      'PAYMENT_GUEST_EPOCH',
      'PAYMENT_GUEST_LIFETIME_SECONDS',
      'STRIPE_CHECKOUT_WEBHOOK_SECRET',
      'STRIPE_CHECKOUT_SUCCESS_URL',
      'STRIPE_CHECKOUT_CANCEL_URL',
    ].map((key) => [key, raw[key]]),
  );
  selected.STRIPE_CHECKOUT_SUCCESS_URL = 'http://127.0.0.1:4175/payments/return';
  selected.STRIPE_CHECKOUT_CANCEL_URL = 'http://127.0.0.1:4175/payments/cancel';
  const receiving = integrations.readStripeReceivingConfiguration(selected, 'test');
  const checkout = integrations.readStripeCheckoutConfiguration(selected, 'test');
  if (
    !receiving ||
    !checkout ||
    !receiving.secretKey.startsWith('sk_test_') ||
    receiving.platformCountry !== 'US' ||
    receiving.platformAccountId !== checkout.platformAccountId ||
    receiving.timeoutMs > 8000
  )
    throw new Error('Verified test-only Stripe configuration required.');
  const saved = z
    .object({
      ownerId: z.uuid(),
      bindingId: z.uuid(),
      accountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
      country: z.literal('US'),
      state: z.literal('bound'),
      keyHash: z.string().regex(/^[a-f0-9]{64}$/),
      requestKey: z.string().regex(/^[a-f0-9]{64}$/),
      testOnly: z.literal(true),
      automaticRecreationAllowed: z.literal(false),
    })
    .parse(
      JSON.parse(
        readFileSync(
          path.join(sourceRoot, 'test-results/b07-05-active-account-context.json'),
          'utf8',
        ),
      ),
    );
  const prior = JSON.parse(
    readFileSync(path.join(sourceRoot, 'test-results/b07-05-sandbox-account-context.json'), 'utf8'),
  );
  if (
    ['ownerId', 'bindingId', 'accountId', 'country', 'requestKey', 'state'].some(
      (key) => saved[key] !== prior[key],
    ) ||
    saved.requestKey !== hash(`stripe_account:${receiving.epoch}:${saved.bindingId}`)
  )
    throw new Error('Original Stripe binding custody differs.');
  return { provider: 'stripe', ownerId: saved.ownerId, receiving, checkout, saved };
}
