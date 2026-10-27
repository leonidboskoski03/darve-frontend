import { test, expect } from '@playwright/test';

const fixture = 'http://127.0.0.1:4175/tests/fixtures/session.html';
const session = {
  authenticated: true,
  user: {
    id: '11223344-1234-4234-8234-112233445566',
    displayName: 'Synthetic creator',
    termsStatus: {
      status: 'unconfigured',
      requiredVersion: null,
      acceptedVersion: null,
      acceptedAt: null,
    },
  },
  expiresAt: '2030-01-01T00:00:00.000Z',
  csrfToken: 'a'.repeat(43),
};
const unsigned = { authenticated: false, user: null, expiresAt: null, csrfToken: null };
const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4175',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'X-CSRF-Token,Content-Type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

test('synthetic transport fixture clears private drafts on confirmed logout and leaves proofs out of storage', async ({
  page,
}) => {
  let authenticated = true;
  let logoutCsrf = '';
  let logoutBody: string | null = 'unexpected';
  await page.route('http://127.0.0.1:3310/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (request.url().endsWith('/logout')) {
      logoutCsrf = request.headers()['x-csrf-token'] ?? '';
      logoutBody = request.postData();
      authenticated = false;
      await route.fulfill({ status: 204, headers: cors });
    } else
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: cors,
        body: JSON.stringify(authenticated ? session : unsigned),
      });
  });
  await page.goto(fixture);
  await expect(page.getByText('Signed in as Synthetic creator', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Temporary private draft' }).fill('private-fixture-text');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('Signed out', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Temporary private draft' })).toHaveCount(0);
  expect(logoutCsrf).toBe(session.csrfToken);
  expect(logoutBody).toBeNull();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('synthetic logout network uncertainty hides private UI and requires explicit retry', async ({
  page,
}) => {
  let attempts = 0;
  await page.route('http://127.0.0.1:3310/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (request.url().endsWith('/logout')) {
      attempts++;
      if (attempts === 1) await route.abort();
      else await route.fulfill({ status: 204, headers: cors });
    } else
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: cors,
        body: JSON.stringify(session),
      });
  });
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByText('Sign-out could not be confirmed. Private content is hidden.'),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Temporary private draft' })).toHaveCount(0);
  expect(attempts).toBe(1);
  await page.getByRole('button', { name: 'Retry sign out' }).click();
  await expect(page.getByText('Signed out', { exact: true })).toBeVisible();
  expect(attempts).toBe(2);
});
