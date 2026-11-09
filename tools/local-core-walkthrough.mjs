import assert from 'node:assert/strict';
import { devices, expect } from '@playwright/test';
import { walkthroughAuthorization, walkthroughCode } from './local-walkthrough-identity.mjs';

export async function enterWalkthrough({ origin, apiOrigin, owner, page }) {
  let authorizations = 0;
  await owner.route(walkthroughAuthorization + '?*', async (route) => {
    const url = new URL(route.request().url());
    const target = apiOrigin + '/api/auth/twitch/callback';
    if (url.searchParams.get('redirect_uri') !== target) return route.abort();
    const callback = new URL(target);
    callback.searchParams.set('state', url.searchParams.get('state'));
    callback.searchParams.set('code', walkthroughCode);
    authorizations++;
    await route.fulfill({ status: 302, headers: { Location: callback.href } });
  });
  await page.goto(origin + '/account');
  await expect(page.getByRole('heading', { name: 'Connect your stream to Darve' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue with Twitch' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your stream' })).toBeVisible();
  assert.equal(authorizations, 1);
  const response = await owner.request.get(apiOrigin + '/api/session');
  assert.equal(response.status(), 200);
  const session = await response.json();
  assert.equal(session.authenticated, true);
  assert.equal(session.user.displayName, 'Synthetic walkthrough creator');
  return { userId: session.user.id };
}

export async function finishWalkthrough({
  origin,
  apiOrigin,
  browser,
  owner,
  page,
  challengePath,
  setPhase,
}) {
  setPhase('retained challenge history');
  const nav = page.getByRole('navigation', { name: 'Creator workspace' });
  await nav.getByRole('link', { name: 'Challenge history' }).click();
  await expect(page.getByRole('heading', { name: 'Challenge history' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View challenge', exact: true })).toHaveAttribute(
    'href',
    challengePath,
  );

  setPhase('OBS link and explicit display selection');
  await nav.getByRole('link', { name: 'OBS display' }).click();
  const create = page.getByRole('button', { name: 'Create private OBS link' });
  await expect(create).toBeDisabled();
  await page.getByRole('checkbox', { name: /I understand this read-only link/ }).check();
  await create.click();
  await page.getByRole('button', { name: 'Review for display', exact: true }).click();
  await page.getByRole('checkbox', { name: /Show this selection/ }).check();
  await page.getByRole('button', { name: 'Confirm display selection' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Display selection confirmed' }),
  ).toBeVisible();
  setPhase('selected display on dashboard and reload');
  const dashboard = page.getByRole('link', { name: 'View this display on the dashboard' });
  const dashboardPath = await dashboard.getAttribute('href');
  assert.match(dashboardPath, /^\/dashboard\?displayId=[a-f0-9-]{36}$/);
  await dashboard.click();
  await expect(page.getByRole('link', { name: 'Open displayed challenge' })).toHaveAttribute(
    'href',
    challengePath,
  );
  await page.reload();
  await expect(page.getByRole('link', { name: 'Open displayed challenge' })).toHaveAttribute(
    'href',
    challengePath,
  );

  setPhase('narrow dashboard and history navigation');
  const mobile = await browser.newContext({
    ...devices['Pixel 7'],
    viewport: { width: 320, height: 851 },
    reducedMotion: 'reduce',
    storageState: { cookies: await owner.cookies(apiOrigin), origins: [] },
  });
  mobile.setDefaultTimeout(10_000);
  await mobile.route('**/*', (route) =>
    [origin, apiOrigin].includes(new URL(route.request().url()).origin)
      ? route.continue()
      : route.abort(),
  );
  try {
    const narrow = await mobile.newPage();
    await narrow.goto(origin + dashboardPath);
    await expect(narrow.getByRole('link', { name: 'Open displayed challenge' })).toHaveAttribute(
      'href',
      challengePath,
    );
    assert.equal(
      await narrow.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
      true,
    );
    await narrow.getByRole('button', { name: 'Open workspace navigation' }).click();
    await narrow.getByRole('dialog').getByRole('link', { name: 'Challenge history' }).click();
    await expect(narrow.getByRole('heading', { name: 'Challenge history' })).toBeVisible();
    await expect(narrow.getByRole('dialog')).toHaveCount(0);
    await expect(narrow.getByRole('main')).toBeFocused();
    await expect(narrow.getByRole('link', { name: 'View challenge', exact: true })).toHaveAttribute(
      'href',
      challengePath,
    );
    setPhase('mobile sign-out and desktop access revocation');
    await narrow.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(
      narrow.getByRole('heading', { name: 'Connect your stream to Darve' }),
    ).toBeVisible();
    const response = await owner.request.get(apiOrigin + '/api/session');
    assert.equal(response.status(), 200);
    assert.equal((await response.json()).authenticated, false);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Connect your stream to Darve' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open displayed challenge' })).toHaveCount(0);
  } finally {
    await mobile.close();
  }
}
