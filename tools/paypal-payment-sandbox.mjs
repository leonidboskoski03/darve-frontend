import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Explicit F06-04 reconnection of the permitted existing seller. Never create a merchant/account. */
export async function createPayPalPaymentSandbox(backend, database, config, sandbox) {
  const load = (name) =>
    import(pathToFileURL(path.join(backend, `packages/${name}/dist/index.js`)).href);
  const db = await load('database'),
    domain = await load('domain'),
    integrations = await load('integrations');
  const hash = (value) => createHash('sha256').update(value).digest('hex'),
    origin = 'http://127.0.0.1:4175';
  const scope = integrations.payPalReceivingScope(sandbox.receiving),
    provider = integrations.createPayPalReceivingProvider(sandbox.receiving);
  let actor = null,
    consentCalls = 0,
    ready = false,
    publicId = null;
  const repository = db.createPayPalReceivingRepository(database, scope, sandbox.cipher);
  const receiving = domain.createPayPalReceivingService(
    repository,
    {
      ...provider,
      async createReferral(...args) {
        if (++consentCalls !== 1) throw Error('One explicit seller reconnection only');
        return provider.createReferral(...args);
      },
      observe: (trackingId, country) =>
        provider.observe(trackingId, country, sandbox.saved.merchantId),
    },
    config.termsPolicy,
  );
  const financial = db.createFinancialStorageRepository(database, {
    guestEpoch: sandbox.checkout.guestEpoch,
    environment: 'test',
    platformAccountIds: { paypal: scope.partnerMerchantId },
    paypalScope: scope,
  });
  const checkoutProvider = integrations.createPayPalCheckoutProvider(sandbox.checkout);
  let createCalls = 0,
    captureCalls = 0,
    guestIssues = 0,
    resumeCalls = 0,
    verifiedReceiptReads = 0,
    challenge = null,
    heldKey = null;
  const base = domain.createPayPalCheckoutService(
    financial,
    {
      ...checkoutProvider,
      async create(operation) {
        if (++createCalls !== 1) throw Error('One approved sandbox order only');
        return checkoutProvider.create(operation);
      },
      async capture(...args) {
        if (++captureCalls !== 1) throw Error('One approved sandbox capture only');
        return checkoutProvider.capture(...args);
      },
    },
    receiving.readiness,
    { creationEnabled: true, guestLifetimeSeconds: 2100 },
    { create: () => randomBytes(32).toString('base64url'), hash, token: randomUUID },
  );
  const service = {
    ...base,
    async issueGuest() {
      guestIssues++;
      return base.issueGuest();
    },
    async status(id, proof) {
      const view = await base.status(id, proof);
      if (view.payments.length) verifiedReceiptReads++;
      return view;
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
        input.paymentProvider !== 'paypal' ||
        input.amountMinor !== '1000' ||
        (heldKey && heldKey !== input.idempotencyKey)
      )
        throw new domain.FinancialStorageError('POLICY_UNAVAILABLE');
      // An expired cookie from a prior disposable run must not reserve this run's one request.
      await financial.checkoutReadiness(input);
      heldKey = input.idempotencyKey;
      return base.checkout(input);
    },
  };
  const cookie = randomBytes(32).toString('base64url'),
    csrf = randomBytes(32).toString('base64url'),
    key = randomUUID();
  const setupPlugin = {
    name: 'explicit-paypal-sandbox-setup',
    configureServer(server) {
      server.middlewares.use('/sandbox/setup', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader(
          'Content-Security-Policy',
          `default-src 'self'; script-src 'nonce-${csrf}'; frame-ancestors 'none'; base-uri 'none'`,
        );
        if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) {
          res.statusCode = 403;
          res.end();
          return;
        }
        if (req.method === 'GET') {
          res.setHeader(
            'Set-Cookie',
            `darve_f06_setup=${cookie}; HttpOnly; SameSite=Lax; Path=/sandbox; Max-Age=1800`,
          );
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(
            `<!doctype html><html><head><meta charset="utf-8"><title>Darve sandbox seller reconnection</title></head><body><h1>PayPal sandbox setup only</h1><p>Reconnect the same existing fictional US seller. No new PayPal account, live payment or commercial agreement. The old tracking record failed current verification.</p><p>By clicking reconnect, the synthetic Darve owner explicitly consents to share the required onboarding data with PayPal. On PayPal, sign in to the existing permitted sandbox seller only.</p><p>Approved subsequent test: USD10.00 contribution with USD0.70 synthetic Darve fee. No real money, delivery or refund promise.</p><button id="connect">Reconnect existing PayPal test seller</button><button id="check">Check current connection</button><p id="state">${ready ? 'Receiving verified' : 'Waiting for your sandbox consent'}</p>${publicId ? `<a href="/contribute/${publicId}">Open fresh-viewer contribution</a>` : '<p>Contribution link becomes available after receiving verification. Refresh this setup page afterward.</p>'}<script nonce="${csrf}">async function action(name){const r=await fetch('/sandbox/setup/'+name,{method:'POST',credentials:'same-origin',headers:{'X-F06-CSRF':${JSON.stringify(csrf)}}});const data=await r.json();document.getElementById('state').textContent=data.ready?'Receiving verified':data.error?'Connection unavailable; no success assumed':'Return here after consent, then check connection';if(data.url)location.assign(data.url);}document.getElementById('connect').onclick=()=>action('connect');document.getElementById('check').onclick=()=>action('check');</script></body></html>`,
          );
          return;
        }
        const cookies = (req.headers.cookie ?? '')
          .split(';')
          .map((v) => v.trim())
          .filter((v) => v.startsWith('darve_f06_setup='));
        if (
          req.method !== 'POST' ||
          req.headers.origin !== origin ||
          req.headers['x-f06-csrf'] !== csrf ||
          cookies.length !== 1 ||
          cookies[0] !== 'darve_f06_setup=' + cookie ||
          !actor
        ) {
          res.statusCode = 403;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        try {
          if (req.url === '/connect') {
            const result = await receiving.onboarding(actor, key, 'US', true);
            res.end(JSON.stringify({ url: result.url }));
          } else if (req.url === '/check') {
            const status = await receiving.refresh(actor);
            ready =
              status.state === 'ready' && status.currencies.includes('USD') && status.walletActive;
            res.end(JSON.stringify({ ready }));
          } else {
            res.statusCode = 404;
            res.end('{}');
          }
        } catch {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: 'SANDBOX_RECEIVING_UNAVAILABLE' }));
        }
      });
    },
  };
  return {
    setupPlugin,
    requiresSetup: true,
    dependencies: {
      checkoutGuestLifetimeSeconds: 2100,
      checkoutService: domain.createGuestCheckoutDispatcher(financial, null, service),
      checkoutExposure: { providers: ['paypal'], readiness: receiving.readiness },
    },
    async configure(owner, secret, proof) {
      if (owner !== sandbox.ownerId) throw Error('Original sandbox owner differs');
      actor = { userId: owner, secretHash: hash(secret), csrfHash: hash(proof) };
      await financial.setAgreement(owner, 0, {
        version: 'f06-04-synthetic-test-only',
        currencies: {
          USD: {
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
    async waitForSetup(milliseconds) {
      const deadline = Date.now() + milliseconds;
      while (!ready && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 1000));
      if (!ready) throw Error('Sandbox seller consent window expired');
    },
    async bindChallenge(id) {
      const value = await database.acceptedChallenge.findUniqueOrThrow({ where: { id } }),
        link = await database.challengePublicLink.findUniqueOrThrow({ where: { challengeId: id } });
      if (value.userId !== sandbox.ownerId || value.currency !== 'USD')
        throw Error('Sandbox challenge differs');
      challenge = { id, publicId: link.publicId, termsVersion: value.termsId };
      publicId = link.publicId;
      return { publicId };
    },
    async audit() {
      const attempts = await database.paymentCheckoutAttempt.findMany({
          select: { state: true, amountMinor: true, darveFeeMinor: true, currency: true },
        }),
        payments = await database.financialPayment.findMany({
          select: { amountMinor: true, currency: true },
        });
      return {
        actualSandboxProvider: 'paypal',
        accountCreationCalls: 0,
        sellerReconnections: consentCalls,
        providerCreateCalls: createCalls,
        captureCalls,
        guestIssues,
        resumeCalls,
        verifiedReceiptReads,
        attemptCount: attempts.length,
        paymentCount: payments.length,
        paypalTimingConfirmations: await database.payPalPaymentConfirmation.count(),
        expectedAmountAndFee: attempts.every(
          (row) =>
            row.amountMinor.toString() === '1000' &&
            row.darveFeeMinor.toString() === '70' &&
            row.currency === 'USD',
        ),
        expectedPaymentAmount: payments.every(
          (row) => row.amountMinor.toString() === '1000' && row.currency === 'USD',
        ),
        states: attempts.map((row) => row.state),
      };
    },
  };
}
