import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const fixture = 'http://127.0.0.1:4175/tests/fixtures/creator.html';
const accountId = '11223344-1234-4234-8234-112233445566';
const connectionId = '22334455-1234-4234-8234-112233445566';
const csrf = 'a'.repeat(43);
const time = '2026-10-27T12:00:00.000Z';
const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4175',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'X-CSRF-Token,Content-Type',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
};
const document = (revision = 1) => ({
  documentId: 'synthetic',
  version: 'test-' + revision,
  classification: 'development',
  contentHash: String(revision).repeat(64),
  content: 'Synthetic development terms. Literal markup: <b>plain text</b>.',
});
const termsStatus = (accepted = false, revision = 1) => ({
  status: accepted ? 'accepted' : 'required',
  documentId: 'synthetic',
  requiredVersion: 'test-' + revision,
  classification: 'development',
  contentHash: String(revision).repeat(64),
  acceptedVersion: accepted ? 'test-' + revision : null,
  acceptedAt: accepted ? time : null,
});
const signedIn = (accepted = false, revision = 1) => ({
  authenticated: true,
  user: {
    id: accountId,
    displayName: 'Synthetic creator',
    termsStatus: termsStatus(accepted, revision),
  },
  expiresAt: '2030-01-01T00:00:00.000Z',
  csrfToken: csrf,
});
const signedOut = { authenticated: false, user: null, expiresAt: null, csrfToken: null };
const connection = (version = 1) => ({
  id: connectionId,
  version,
  provider: 'twitch',
  grantState: 'usable',
  channels: [
    {
      id: accountId,
      providerChannelId: 'synthetic-channel',
      displayName: 'Synthetic channel',
      handle: null,
      avatarUrl: null,
      ownershipVerifiedAt: time,
    },
  ],
  capabilities: {
    chatRead: { available: false, reasonCode: 'PERMISSION_REQUIRED' },
    chatWrite: { available: false, reasonCode: 'BOT_UNCONFIGURED' },
    liveContext: { available: false, reasonCode: 'OFFLINE' },
    metrics: { available: false, reasonCode: 'METRIC_UNAVAILABLE' },
  },
  senderMode: 'darve_bot',
  observedAt: time,
  reauthorizationRequired: false,
});
const envelope = (data: unknown) => ({ schemaVersion: 1, serverTime: time, data });
const fail = (code: string) => ({
  schemaVersion: 1,
  serverTime: time,
  error: {
    code,
    message: 'private-synthetic-message',
    requestId: 'synthetic-request',
    retryable: false,
    retryAfterSeconds: null,
    issues: [],
    refetch: null,
  },
});
async function json(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: cors,
    body: JSON.stringify(data),
  });
}
async function mock(page: Page, handle: (route: Route, path: string) => Promise<void>) {
  await page.route('http://127.0.0.1:3310/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    await handle(route, new URL(route.request().url()).pathname);
  });
}

for (const [provider, label, target] of [
  ['twitch', 'Twitch', 'https://id.twitch.tv/oauth2/authorize'],
  ['youtube', 'YouTube', 'https://accounts.google.com/o/oauth2/v2/auth'],
  ['kick', 'Kick', 'https://id.kick.com/oauth/authorize'],
] as const) {
  test(`synthetic ${provider} sign-in sends the exact backend start intent and follows only its approved destination`, async ({
    page,
  }) => {
    let submitted: unknown = null;
    await mock(page, async (route, path) => {
      if (path === '/api/session') await json(route, signedOut);
      else if (path === `/api/auth/${provider}/start`) {
        submitted = route.request().postDataJSON();
        expect(route.request().headers()['x-csrf-token']).toBeUndefined();
        await json(route, {
          authorizationUrl: target + '?state=synthetic&response_type=code',
          expiresAt: '2030-01-01T00:00:00.000Z',
        });
      } else await json(route, fail('UNEXPECTED_SYNTHETIC_REQUEST'), 404);
    });
    await page.route(target + '**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic provider destination</h1>' }),
    );
    await page.goto(fixture);
    for (const name of ['Twitch', 'YouTube', 'Kick'])
      await expect(page.getByRole('button', { name: 'Continue with ' + name })).toBeEnabled();
    await page.getByRole('button', { name: 'Continue with ' + label }).click();
    await expect(
      page.getByRole('heading', { name: 'Synthetic provider destination' }),
    ).toBeVisible();
    expect(submitted).toEqual({
      intent: 'sign_in',
      connectionId: null,
      returnPath: '/integrations',
    });
  });
}

test('synthetic current terms require unchecked explicit consent and canonical session refresh after acceptance', async ({
  page,
}) => {
  let accepted = false,
    posted: unknown = null;
  await mock(page, async (route, path) => {
    if (path === '/api/session') await json(route, signedIn(accepted));
    else if (path === '/api/terms/current') await json(route, envelope(document()));
    else if (path === '/api/terms/acceptance') {
      posted = route.request().postDataJSON();
      expect(route.request().headers()['x-csrf-token']).toBe(csrf);
      accepted = true;
      await json(route, envelope(termsStatus(true)));
    } else if (path === '/api/connections')
      await json(route, envelope({ items: [], nextCursor: null }));
    else await json(route, fail('UNEXPECTED_SYNTHETIC_REQUEST'), 404);
  });
  await page.goto(fixture + '?view=integrations');
  const button = page.getByRole('button', { name: 'Accept and continue' });
  await expect(button).toBeDisabled();
  await expect(
    page.getByRole('region', { name: 'Current account terms' }).locator('b'),
  ).toHaveCount(0);
  await page.getByRole('checkbox', { name: /I have read and accept/ }).check();
  await button.click();
  await expect(page.getByRole('heading', { name: 'Your streaming accounts' })).toBeVisible();
  expect(posted).toEqual({
    documentId: 'synthetic',
    version: 'test-1',
    contentHash: '1'.repeat(64),
    accepted: true,
  });
  await expect(page.getByText('No account is connected.', { exact: true })).toHaveCount(3);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('synthetic changed terms refresh the document and clear consent without automatically resubmitting', async ({
  page,
}) => {
  let revision = 1,
    posts = 0;
  await mock(page, async (route, path) => {
    if (path === '/api/session') await json(route, signedIn(false, revision));
    else if (path === '/api/terms/current') await json(route, envelope(document(revision)));
    else if (path === '/api/terms/acceptance') {
      posts++;
      revision = 2;
      await json(route, fail('TERMS_CHANGED'), 409);
    } else await json(route, fail('UNEXPECTED_SYNTHETIC_REQUEST'), 404);
  });
  await page.goto(fixture + '?view=integrations');
  await page.getByRole('checkbox', { name: /test-1/ }).check();
  await page.getByRole('button', { name: 'Accept and continue' }).click();
  await expect(page.getByRole('checkbox', { name: /test-2/ })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Accept and continue' })).toBeDisabled();
  expect(posts).toBe(1);
});

test('synthetic provider permissions preserve separate identity, chat and explicit DarveBot intent', async ({
  page,
}) => {
  const bodies: unknown[] = [];
  await mock(page, async (route, path) => {
    if (path === '/api/session') await json(route, signedIn(true));
    else if (path === '/api/connections')
      await json(route, envelope({ items: [connection()], nextCursor: null }));
    else if (path === '/api/auth/twitch/start') {
      bodies.push(route.request().postDataJSON());
      expect(route.request().headers()['x-csrf-token']).toBe(csrf);
      await json(route, fail('PROVIDER_UNAVAILABLE'), 503);
    } else await json(route, fail('UNEXPECTED_SYNTHETIC_REQUEST'), 404);
  });
  await page.goto(fixture + '?view=integrations');
  const card = page.getByRole('region', { name: 'Twitch', exact: true });
  await card.getByRole('button', { name: 'Allow DarveBot notices' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Continue to provider' })).toBeDisabled();
  await expect(dialog.getByText(/does not allow replacing a pinned message/)).toBeVisible();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Continue to provider' }).click();
  await expect(dialog.getByRole('alert')).toContainText('not configured');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  for (const name of ['Allow chat reading', 'Reconnect account']) {
    await card.getByRole('button', { name, exact: true }).click();
    await dialog.getByRole('button', { name: 'Continue to provider' }).click();
    await expect(dialog.getByRole('alert')).toContainText('not configured');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  }
  expect(bodies).toEqual(
    ['bot_destination', 'streaming', 'identity'].map((purpose) => ({
      intent: 'reauthorize',
      connectionId,
      authorizationPurpose: purpose,
      returnPath: '/integrations',
    })),
  );
});

test('synthetic stale unlink requires a fresh confirmation and empty 204 reinspects an ended session', async ({
  page,
}) => {
  let version = 1,
    signed = true;
  const expected: unknown[] = [];
  await mock(page, async (route, path) => {
    if (path === '/api/session') await json(route, signed ? signedIn(true) : signedOut);
    else if (path === '/api/connections')
      await json(route, envelope({ items: [connection(version)], nextCursor: null }));
    else if (path === '/api/connections/' + connectionId && route.request().method() === 'DELETE') {
      expected.push(route.request().postDataJSON());
      if (version === 1) {
        version = 2;
        await json(route, fail('STALE_VERSION'), 409);
      } else {
        signed = false;
        await route.fulfill({ status: 204, headers: cors });
      }
    } else await json(route, fail('UNEXPECTED_SYNTHETIC_REQUEST'), 404);
  });
  await page.goto(fixture + '?view=integrations');
  const card = page.getByRole('region', { name: 'Twitch', exact: true });
  await card.getByRole('button', { name: 'Disconnect', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Disconnect account', exact: true }).click();
  await expect(dialog.getByText(/This connection changed/)).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Disconnect account', exact: true }),
  ).toBeDisabled();
  expect(expected).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await card.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await dialog.getByRole('button', { name: 'Disconnect account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect your stream to Darve' })).toBeVisible();
  await expect(page.getByText('Synthetic channel', { exact: true })).toHaveCount(0);
  expect(expected).toEqual([{ expectedVersion: 1 }, { expectedVersion: 2 }]);
});

test('synthetic creator 401 clears the account screen and keyboard dialog flow stays accessible', async ({
  page,
}) => {
  let expired = false;
  await mock(page, async (route, path) => {
    if (path === '/api/session') await json(route, signedIn(true));
    else if (path === '/api/connections')
      await json(
        route,
        expired ? fail('SESSION_REQUIRED') : envelope({ items: [connection()], nextCursor: null }),
        expired ? 401 : 200,
      );
    else await json(route, fail('UNEXPECTED_SYNTHETIC_REQUEST'), 404);
  });
  await page.goto(fixture + '?view=integrations');
  await expect(page.getByText('Synthetic channel', { exact: true })).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await expect(page.getByRole('dialog', { name: 'Explore Darve' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeFocused();
  expired = true;
  await page.getByRole('button', { name: 'Refresh accounts' }).click();
  await expect(page.getByText('Your session expired. Sign in again to continue.')).toBeVisible();
  await expect(page.getByText('Synthetic channel', { exact: true })).toHaveCount(0);
});

test('public OAuth return removes secret fields and cannot fabricate signed-in UI', async ({
  page,
}) => {
  await page.goto(
    '/integrations?oauth_result=success&oauth_provider=twitch&code=synthetic-private&state=synthetic-private#access_token=synthetic-private',
  );
  expect(new URL(page.url()).searchParams.has('code')).toBe(false);
  expect(new URL(page.url()).searchParams.has('state')).toBe(false);
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByRole('heading', { name: 'Your streaming accounts' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with Twitch' })).toBeDisabled();
});
