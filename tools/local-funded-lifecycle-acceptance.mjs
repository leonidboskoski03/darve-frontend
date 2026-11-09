import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices, expect } from '@playwright/test';
import jsQR from 'jsqr';
import { build, preview } from 'vite';
import { startLocalApi } from './local-api.mjs';

const origin = 'http://127.0.0.1:4175';
const directory = resolve('artifacts.local/f10-03');
const outDir = resolve(directory, 'product-build');
const checks = [],
  errors = [],
  blocked = [];
let api,
  site,
  browser,
  result,
  stage = 'startup';
const check = (name) => {
  checks.push(name);
  console.log('PASS ' + name);
};

try {
  api = await startLocalApi({
    backend: process.argv[2] ?? '../tmp/backend-f06-checkout',
    task: 'f10-03',
    origins: [origin],
    collection: true,
    review: true,
    terms: true,
    overlay: true,
    checkout: true,
  });
  process.env.VITE_APP_ENV = 'local';
  process.env.VITE_PUBLIC_API_ORIGIN = api.apiOrigin;
  await build({ envDir: false, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  site = await preview({
    logLevel: 'silent',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  });
  browser = await chromium.launch();
  const makeContext = async (options = {}) => {
    const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
    context.setDefaultTimeout(12_000);
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.name)));
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if ([origin, api.apiOrigin].includes(url.origin)) return route.continue();
      blocked.push('unexpected outbound browser request');
      return route.abort();
    });
    return context;
  };
  const owner = await makeContext();
  const get = async (context, path) => {
    const response = await context.request.get(api.apiOrigin + path, {
      headers: { Origin: origin },
    });
    assert.equal(response.status(), 200);
    return (await response.json()).data;
  };
  const creator = await api.seedSession({ expiresInMs: 600_000 });
  await owner.addCookies([
    {
      name: 'darve_session',
      value: creator.secret,
      url: api.apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await owner.newPage();
  stage = 'owner terms and receiving configuration';
  await page.goto(origin + '/collection');
  await page.getByRole('checkbox', { name: /I have read and accept account terms/ }).check();
  await page.getByRole('button', { name: 'Accept and continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start collection', exact: true })).toBeVisible();
  const session = await (await owner.request.get(api.apiOrigin + '/api/session')).json();
  const fixture = api.checkoutFixture;
  await fixture.configure(creator.userId, creator.secret, session.csrfToken);
  api.collectionFixture.capacity('available');
  const stream = await api.collectionFixture.seed(creator.userId, 'TWITCH');

  stage = 'production collection source selection';
  await page.reload();
  await page.getByRole('combobox', { name: 'Connected account' }).selectOption(stream.connectionId);
  await page.getByLabel('Collection duration').fill('60');
  stage = 'production collection Start';
  await page.getByRole('button', { name: 'Start collection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Preparing your collection' })).toBeVisible();
  const roundId = new URL(page.url()).pathname.split('/').at(-1);
  stage = 'collection admission, Stop and publication';
  await api.collectionFixture.recover();
  await expect(page.getByRole('heading', { name: 'Collecting viewer ideas' })).toBeVisible();
  await api.collectionFixture.admitIdeas(creator.userId, roundId);
  await page.getByRole('button', { name: 'Stop collection', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm stop', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Collection ended' })).toBeVisible();
  await api.reviewFixture.publish(creator.userId, roundId);
  stage = 'review and challenge acceptance';
  await page.getByRole('link', { name: 'Review viewer ideas', exact: true }).click();
  await page.getByRole('button', { name: 'Accept idea 1', exact: true }).click();
  await page.getByLabel('Funding goal', { exact: true }).fill('10.00');
  await page.getByLabel('Currency', { exact: true }).selectOption('EUR');
  await page.getByLabel('Funding duration in seconds', { exact: true }).fill('600');
  await page.getByRole('button', { name: 'Review exact terms', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm acceptance', exact: true }).click();
  stage = 'accepted challenge details and terms';
  const challengeLink = page.getByRole('link', { name: 'View challenge details and declaration' });
  const challengeId = (await challengeLink.getAttribute('href')).split('/').at(-1);
  const challengeApi = '/api/challenges/' + challengeId;
  const detail = await get(owner, challengeApi);
  assert.equal(detail.roundId, roundId);
  assert.deepEqual(detail.terms.goal, { amountMinor: '1000', currency: 'EUR' });
  assert.deepEqual(await api.reviewFixture.counts(creator.userId), { challenges: 1, receipts: 1 });
  assert.equal(detail.funding.eligibleGross, '0');
  check(
    'One reviewed browser collection produces the exact accepted round, challenge and EUR10 goal.',
  );

  stage = 'OBS selection, isolated reader and decoded QR';
  await page.goto(origin + '/obs');
  const issue = page.getByRole('button', { name: 'Create private OBS link' });
  await expect(issue).toBeDisabled();
  await page.getByRole('checkbox', { name: /I understand this read-only link/ }).check();
  await issue.click();
  const privateField = page.getByLabel('Private browser-source URL');
  await expect(privateField).toBeVisible();
  const privateUrl = await privateField.inputValue();
  const displayId = new URL(privateUrl).pathname.split('/').at(-1);
  await page.getByRole('button', { name: 'Review for display', exact: true }).click();
  await page.getByRole('checkbox', { name: /Show this selection/ }).check();
  await page.getByRole('button', { name: 'Confirm display selection', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Display selection confirmed' }),
  ).toBeVisible();
  const binding = await get(owner, '/api/overlay-displays/' + displayId);
  assert.equal(binding.challengeId, challengeId);
  assert.equal(binding.roundId, roundId);
  const reader = await makeContext({ viewport: { width: 1920, height: 1080 } });
  const obs = await reader.newPage();
  let bootstrap = 0;
  obs.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/session'))
      bootstrap++;
  });
  await obs.goto(privateUrl, { waitUntil: 'domcontentloaded' });
  await expect(obs.getByRole('heading', { name: detail.terms.text, exact: true })).toBeVisible();
  assert.equal(bootstrap, 1);
  assert.ok(new URL(obs.url()).hash.startsWith('#grantId='));
  assert.equal(
    (await reader.cookies(api.apiOrigin)).some(({ name }) => name === 'darve_session'),
    false,
  );
  const bar = obs.getByRole('progressbar', { name: 'Deadline-eligible contributions' });
  await expect(bar).toHaveAttribute('aria-valuenow', '0');
  const qr = obs.getByRole('img', { name: 'Scan to view this challenge' });
  const pixels = await qr.evaluate(async (node) => {
    const image = new globalThis.Image();
    image.src =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(new globalThis.XMLSerializer().serializeToString(node));
    await image.decode();
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = canvas.height = 150;
    const drawing = canvas.getContext('2d');
    drawing.imageSmoothingEnabled = false;
    drawing.drawImage(image, 0, 0, 150, 150);
    return Array.from(drawing.getImageData(0, 0, 150, 150).data);
  });
  const destination = jsQR(new Uint8ClampedArray(pixels), 150, 150)?.data;
  assert.equal(destination, detail.contributionUrl);
  assert.equal(destination, origin + '/contribute/' + detail.publicId);
  check(
    'Explicit OBS selection renders the same challenge and its pixels decode to the exact public URL.',
  );

  const publicApi = '/api/public/challenges/' + detail.publicId;
  const prepare = async (provider, amount, minor, fee, options) => {
    const context = await makeContext(options);
    assert.deepEqual(await context.cookies(api.apiOrigin), []);
    const guest = await context.newPage();
    await guest.goto(destination);
    await expect(
      guest.getByRole('heading', { name: detail.terms.text, exact: true }),
    ).toBeVisible();
    await guest.getByLabel('Amount (EUR)', { exact: true }).fill(amount);
    await guest
      .getByRole('combobox', { name: 'Payment method', exact: true })
      .selectOption(provider);
    await guest.getByRole('checkbox', { name: /I reviewed this challenge/ }).check();
    const requests = [];
    guest.on('request', (request) => {
      if (request.url() === api.apiOrigin + publicApi + '/checkouts' && request.method() === 'POST')
        requests.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
    });
    await guest.getByRole('button', { name: 'Prepare checkout', exact: true }).click();
    const receiptHeading = guest.getByRole('heading', { name: 'Private contribution receipt' });
    const same = guest.getByRole('button', { name: 'Continue same contribution', exact: true });
    await expect(receiptHeading.or(same)).toBeVisible();
    if (await same.isVisible()) await same.click();
    await expect(receiptHeading).toBeVisible();
    const id = new URL(guest.url()).pathname.split('/').at(-1);
    const path = '/api/checkouts/' + id;
    const receipt = await get(context, path);
    assert.equal(receipt.publicChallengeId, detail.publicId);
    assert.equal(receipt.termsVersion, detail.terms.version);
    assert.deepEqual(receipt.amount, { amountMinor: minor, currency: 'EUR' });
    assert.deepEqual(receipt.darveFee, { amountMinor: fee, currency: 'EUR' });
    assert.equal(receipt.paymentProvider, provider);
    assert.equal(requests.length, 2);
    assert.ok(requests[0].key);
    assert.deepEqual(requests[0], requests[1]);
    await guest.reload();
    await expect(guest.getByRole('heading', { name: 'Payment not confirmed' })).toBeVisible();
    assert.equal(requests.length, 2);
    return { context, guest, id, path };
  };
  const expectEligibility = async (context, path, amount, eligibility) => {
    const { payments } = await get(context, path);
    assert.equal(payments.length, 1);
    assert.equal(payments[0].amountMinor, amount);
    assert.equal(payments[0].eligibility, eligibility);
  };
  const continueCheckout = async ({ guest }, name, pattern) => {
    await guest.route(pattern, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<h1>Controlled provider handoff</h1>',
      }),
    );
    await guest.getByRole('checkbox', { name: /I reviewed this checkout/ }).check();
    await guest.getByRole('button', { name: 'Continue to ' + name, exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Controlled provider handoff' })).toBeVisible();
  };

  stage = 'Stripe return, delayed timing and receipt recovery';
  const stripe = await prepare('stripe', '4.00', '400', '58');
  const paypal = await prepare('paypal', '6.00', '600', '62', devices['Pixel 7']);
  for (const [foreign, path, status] of [
    [stripe.context, paypal.path, 404],
    [paypal.context, stripe.path, 404],
    [reader, stripe.path, 401],
  ])
    assert.equal((await foreign.request.get(api.apiOrigin + path)).status(), status);
  await continueCheckout(
    stripe,
    'Stripe',
    /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_[a-z0-9]+$/,
  );
  await stripe.guest.goto(
    `${origin}/payments/return?checkout=${stripe.id}&status=success#untrusted`,
  );
  await expect(stripe.guest.getByRole('heading', { name: 'Payment not confirmed' })).toBeVisible();
  assert.equal(new URL(stripe.guest.url()).search, '');
  assert.equal(new URL(stripe.guest.url()).hash, '');
  assert.equal((await fixture.audit()).payments, 0);
  await fixture.observeStripe(stripe.id, false);
  await stripe.guest.getByRole('button', { name: 'Refresh receipt' }).click();
  await expect(
    stripe.guest.getByRole('heading', { name: 'Payment timing needs review' }),
  ).toBeVisible();
  await expectEligibility(stripe.context, stripe.path, '400', 'unclassified');
  const unclassified = await get(stripe.context, publicApi);
  assert.equal(unclassified.funding.confirmedGross, '400');
  assert.equal(unclassified.funding.eligibleGross, '0');
  assert.equal((await get(owner, challengeApi)).funding.unclassifiedGross, '400');
  await expect(bar).toHaveAttribute('aria-valuenow', '0');
  await fixture.observeStripe(stripe.id, true);
  await stripe.guest.getByRole('button', { name: 'Refresh receipt' }).click();
  await expect(stripe.guest.getByRole('heading', { name: 'Deadline eligible' })).toBeVisible();
  await expectEligibility(stripe.context, stripe.path, '400', 'eligible');
  await expect(bar).toHaveAttribute('aria-valuenow', '40', { timeout: 20_000 });
  assert.equal((await fixture.audit()).payments, 1);
  await stripe.guest.reload();
  await expect(stripe.guest.getByRole('heading', { name: 'Deadline eligible' })).toBeVisible();
  check(
    'Fresh browser receipts are private and stable across reload. Stripe timing advances OBS from 0% to 40% without a second payment.',
  );

  stage = 'PayPal explicit capture and same-key replay';
  await continueCheckout(
    paypal,
    'PayPal',
    /^https:\/\/www\.sandbox\.paypal\.com\/checkoutnow\?token=ORDER1$/,
  );
  await paypal.guest.goto(`${origin}/payments/return?checkout=${paypal.id}&status=success`);
  const complete = paypal.guest.getByRole('button', {
    name: 'Complete PayPal payment',
    exact: true,
  });
  await expect(complete).toBeDisabled();
  assert.equal((await fixture.audit()).captures, 0);
  await fixture.approve(paypal.id);
  await paypal.guest.getByRole('checkbox', { name: /I approved this order on PayPal/ }).check();
  const completionUrl = api.apiOrigin + paypal.path + '/complete';
  const pendingRequest = paypal.guest.waitForRequest(
    (request) => request.method() === 'POST' && request.url() === completionUrl,
  );
  await complete.click();
  await expect(
    paypal.guest.getByRole('heading', { name: 'Verified payment recorded' }),
  ).toBeVisible();
  const original = await pendingRequest;
  const key = original.headers()['idempotency-key'];
  assert.ok(key);
  const replay = await paypal.context.request.post(completionUrl, {
    headers: { Origin: origin, 'Idempotency-Key': key },
    data: original.postDataJSON(),
  });
  assert.equal(replay.status(), 200);
  await paypal.guest.reload();
  await expect(
    paypal.guest.getByRole('heading', { name: 'Verified payment recorded' }),
  ).toBeVisible();
  await expectEligibility(paypal.context, paypal.path, '600', 'eligible');
  const { stripeCreates, paypalCreates, captures, attempts, payments } = await fixture.audit();
  assert.deepEqual(
    { stripeCreates, paypalCreates, captures, attempts, payments },
    {
      stripeCreates: 1,
      paypalCreates: 1,
      captures: 1,
      attempts: 2,
      payments: 2,
    },
  );
  check(
    'Mobile PayPal return requires explicit completion. Reload and same-key replay leave one capture and two total checkout payments.',
  );

  stage = 'same challenge funding across owner, public and OBS';
  const publicPage = await paypal.context.newPage();
  await publicPage.goto(destination);
  await expect(publicPage.getByText('Goal recognized', { exact: true })).toBeVisible();
  await expect(publicPage.getByRole('progressbar')).toHaveAttribute('value', '100');
  await expect(obs.getByText('Goal reached', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(bar).toHaveAttribute('aria-valuenow', '100');
  await expect(qr).toHaveCount(0);
  await obs.reload();
  await expect(obs.getByText('Goal reached', { exact: true })).toBeVisible();
  assert.equal(bootstrap, 1);
  const funded = await get(owner, challengeApi);
  const publicFunded = await get(paypal.context, publicApi);
  for (const snapshot of [funded, publicFunded]) {
    assert.equal(snapshot.terms.version, detail.terms.version);
    assert.equal(snapshot.funding.state, 'funded');
    assert.equal(snapshot.funding.confirmedGross, '1000');
    assert.equal(snapshot.funding.eligibleGross, '1000');
    assert.equal(snapshot.performance.state, 'awaiting_performance');
  }
  assert.equal(await fixture.declarationCount(creator.userId), 0);
  check(
    'Owner, public and OBS projections agree on EUR10 eligible funding, with performance still awaiting declaration.',
  );

  stage = 'reviewed owner declaration';
  await page.goto(origin + '/challenges/' + challengeId);
  await page.getByRole('button', { name: 'Declare completion', exact: true }).click();
  const declaration = page.getByRole('button', {
    name: 'Confirm completion declaration',
    exact: true,
  });
  await expect(declaration).toBeDisabled();
  await page.getByRole('checkbox', { name: /I confirm I completed this challenge/ }).check();
  await declaration.click();
  await expect(
    page.getByText('Your completion declaration was recorded', { exact: false }),
  ).toBeVisible();
  stage = 'declaration on OBS and public page';
  await expect(obs.getByText('Streamer declared complete', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await publicPage.getByRole('button', { name: 'Refresh challenge' }).click();
  await expect(publicPage.getByText('Streamer declared complete', { exact: true })).toBeVisible();
  const declared = await get(owner, challengeApi);
  stage = 'canonical declaration and dashboard totals';
  assert.deepEqual(declared.terms, funded.terms);
  assert.equal(declared.performance.verification, 'streamer_declaration');
  assert.equal(await fixture.declarationCount(creator.userId), 1);
  const { history, currentStream } = await get(owner, '/api/dashboard/summary?timeZone=UTC');
  assert.equal(currentStream.broadcastId, stream.broadcastId);
  assert.equal(history.acceptedChallenges, 1);
  assert.equal(history.historicallyFundedChallenges, 1);
  assert.equal(history.streamerDeclaredCompletions, 1);
  assert.deepEqual(
    history.contributionsByCurrency.map((row) => [
      row.currency,
      row.grossContributions,
      row.paymentCount,
    ]),
    [['EUR', '1000', 2]],
  );
  stage = 'rendered date-filtered dashboard';
  await page.goto(origin + '/dashboard?timeZone=UTC');
  const dated = page.locator('section.report-panel').filter({
    has: page.getByRole('heading', { name: 'Date-filtered history', exact: true }),
  });
  await expect(dated.getByText('2 verified payments', { exact: true })).toBeVisible();
  stage = 'rendered retained challenge history';
  await page.goto(origin + '/challenges?status=declared');
  await expect(page.getByRole('link', { name: 'View challenge', exact: true })).toHaveAttribute(
    'href',
    '/challenges/' + challengeId,
  );
  stage = 'browser isolation and error audit';
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
  check(
    'One reviewed owner declaration propagates to the public and OBS views and reconciles with dashboard totals.',
  );
  result = {
    task: 'F10-03',
    backend: api.source,
    migrations: api.migrations,
    frontend: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    checks,
    attempts,
    payments,
    captures,
    declarations: 1,
    controlledExternalFacts: true,
    genuineSandboxPayment: false,
    nativeObsObserved: false,
  };
} catch (error) {
  // Playwright messages and stacks can include private receipt or grant URLs.
  console.error('Funded lifecycle failed at ' + stage + ' (' + error.name + ').');
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled([
    browser?.close(),
    site &&
      new Promise((done) => {
        site.httpServer.closeAllConnections();
        site.httpServer.close(done);
      }),
    api?.close(),
  ]);
  if (cleanup.some(({ status }) => status === 'rejected')) {
    console.error('Funded lifecycle cleanup did not complete.');
    process.exitCode = 1;
  }
  if (result && !process.exitCode) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, 'acceptance.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
}
