import { chromium, expect } from '@playwright/test';
import {
  apiOrigin,
  frontendOrigin,
  localChallengeId,
  signInOrigin,
  startCreatorSignIn,
} from './local-creator-session.mjs';

let browser, signIn, owner, guest, session, grantId;
let step = 'Open the canonical creator sign-in';
try {
  const challengeId = localChallengeId();
  signIn = await startCreatorSignIn();
  browser = await chromium.launch();
  owner = await browser.newContext();
  guest = await browser.newContext();
  const page = await owner.newPage();
  await page.goto(signInOrigin);
  await page.getByRole('button', { name: 'Sign in as the local test creator' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  const inspection = await owner.request.get(apiOrigin + '/api/session', {
    headers: { Origin: frontendOrigin },
  });
  session = await inspection.json();
  expect(session.authenticated).toBe(true);
  expect(session.user.displayName).toBe('Local test creator');
  console.log('PASS Creator sign-in and dashboard');

  step = 'Read the persisted sandbox receiving connections';
  await page.goto(frontendOrigin + '/account/payments');
  await expect(page.getByRole('heading', { name: 'Payout settings' })).toBeVisible();
  await expect(page.getByText('Test environment', { exact: true })).toBeVisible();
  for (const name of ['Stripe', 'PayPal']) {
    const provider = page.getByRole('region', { name, exact: true });
    await provider.getByRole('button', { name: 'Verify ' + name + ' receiving' }).click();
    await expect(provider.getByText('Receiving verified', { exact: true })).toBeVisible({
      timeout: 12000,
    });
    await expect(provider.getByText('Last verified')).toBeVisible();
  }
  console.log('PASS Stripe and PayPal sandbox connection records');

  step = 'Open the public contribution and checkout page';
  const viewer = await guest.newPage();
  const contribution = await viewer.goto(frontendOrigin + '/contribute/' + challengeId);
  expect(contribution?.ok()).toBe(true);
  await expect(viewer.getByRole('progressbar')).toBeVisible();
  await expect(viewer.getByRole('progressbar', { name: 'Funding progress' })).toBeVisible();
  const checkout = viewer.getByRole('heading', { name: 'Other ways to pay' });
  if (process.argv.includes('--require-open-checkout')) await expect(checkout).toBeVisible();
  if (await checkout.isVisible()) {
    await expect(viewer.getByLabel('Payment method')).toBeVisible();
    console.log('PASS Guest sandbox contribution page and checkout form');
  } else {
    console.log('PASS Guest sandbox contribution page and closed checkout state');
  }

  step = 'Bootstrap the standalone OBS page with a new read-only grant';
  await page.goto(frontendOrigin + '/obs');
  await page.getByRole('checkbox', { name: /I understand this read-only link/ }).check();
  const issued = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url() === apiOrigin + '/api/overlay-grants',
  );
  await page.getByRole('button', { name: 'Create private OBS link' }).click();
  const grantResponse = await issued;
  expect(grantResponse.ok()).toBe(true);
  const { data } = await grantResponse.json();
  grantId = data.id;
  const url = new URL(data.presentationUrl);
  expect(url.origin).toBe(frontendOrigin);
  const loaded = viewer.waitForResponse(
    (response) =>
      response.ok() &&
      response.url().startsWith(apiOrigin + '/api/overlays/' + data.displayId + '/snapshot'),
  );
  await viewer.goto(url.href);
  await loaded;
  console.log('PASS Standalone OBS page and actual API snapshot');
} catch {
  console.error(
    'FAIL ' + step + '. Check local API/frontend readiness and the seeded sandbox data.',
  );
  process.exitCode = 1;
} finally {
  try {
    if (session?.authenticated && owner) await cleanUpSession();
  } catch {
    console.error('FAIL Revoke the walkthrough grant and session.');
    process.exitCode = 1;
  } finally {
    await browser?.close();
    signIn?.close();
  }
}

async function cleanUpSession() {
  const headers = { Origin: frontendOrigin, 'X-CSRF-Token': session.csrfToken };
  let revoked = true;
  try {
    if (grantId)
      revoked = (
        await owner.request.delete(apiOrigin + '/api/overlay-grants/' + grantId, { headers })
      ).ok();
  } catch {
    revoked = false;
  }
  const logout = await owner.request.post(apiOrigin + '/api/session/logout', { headers });
  if (!revoked || !logout.ok()) throw new Error('Walkthrough cleanup failed');
}
