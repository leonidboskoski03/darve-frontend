import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const api = 'http://127.0.0.1:3320';
const fixture = 'http://127.0.0.1:4175/tests/fixtures/staff.html';
const proof = 's'.repeat(43);
const expires = () => new Date(Date.now() + 180000).toISOString();
const pending = () => ({ state: 'email_code_pending', expiresAt: expires(), csrfToken: proof });
const enrollment = () => ({
  state: 'enrollment_pending',
  role: 'SUPPORT',
  expiresAt: expires(),
  csrfToken: proof,
});
const authenticated = () => ({
  state: 'authenticated',
  staff: { id: '12345678-1234-4234-8234-123456789012', role: 'SUPPORT', revision: 1 },
  permissions: ['tickets.reply'],
  expiresAt: expires(),
  authenticatedAt: new Date().toISOString(),
  csrfToken: proof,
});
type FixtureState = {
  session: unknown;
  pending: unknown;
  wrong: boolean;
  logoutLost: boolean;
  writes: { path: string; body: unknown; csrf: string | undefined }[];
  cleanAtRead: boolean;
};
async function mock(page: Page, state: FixtureState) {
  await page.route(api + '/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const headers = {
      'access-control-allow-origin': 'http://127.0.0.1:4175',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'Content-Type, X-Staff-CSRF',
      'access-control-allow-methods': 'GET, POST',
      'content-type': 'application/json',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    let status = 200,
      data: unknown;
    if (request.method() === 'GET') {
      state.cleanAtRead &&= !new URL(page.url()).hash && !new URL(page.url()).search;
      if (path.endsWith('/email-code')) {
        data = state.pending;
        if (!data) status = 401;
      } else {
        data = state.session;
        if (!data) status = 401;
      }
    } else {
      const body: unknown = request.postDataJSON();
      state.writes.push({ path, body, csrf: request.headers()['x-staff-csrf'] });
      if (path.endsWith('/verify')) {
        if (state.wrong) status = 401;
        else {
          state.pending = null;
          state.session = enrollment();
          data = { state: 'enrollment_pending', returnPath: '/staff/enrol' };
        }
      } else if (path.endsWith('/accept')) {
        state.session = authenticated();
        data = { accepted: true };
      } else if (path.endsWith('/resend')) data = { sent: true };
      else if (path.endsWith('/cancel')) {
        state.pending = null;
        data = { cancelled: true };
      } else if (path.endsWith('/logout')) {
        if (state.logoutLost) {
          await route.abort('failed');
          return;
        }
        state.session = { state: 'signed_out' };
        data = { signedOut: true };
      } else {
        const destination = new URL('http://127.0.0.1:3321/authorize');
        for (const [key, value] of Object.entries({
          state: proof,
          nonce: proof,
          code_challenge: proof,
          response_type: 'code',
          redirect_uri: api + '/admin/v1/auth/callback',
          code_challenge_method: 'S256',
          prompt: 'login',
          max_age: '0',
        }))
          destination.searchParams.set(key, value);
        data = { authorizationUrl: destination.href };
      }
    }
    const body =
      status === 200
        ? { schemaVersion: 1, serverTime: new Date().toISOString(), data }
        : {
            schemaVersion: 1,
            serverTime: new Date().toISOString(),
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Synthetic private marker',
              requestId: 'synthetic',
              retryable: false,
              retryAfterSeconds: null,
              issues: [],
              refetch: null,
            },
          };
    await route.fulfill({ status, headers, body: JSON.stringify(body) });
  });
}
const state = (): FixtureState => ({
  session: { state: 'signed_out' },
  pending: null,
  wrong: false,
  logoutLost: false,
  writes: [],
  cleanAtRead: true,
});

test('separate staff product entry is unavailable without configuration and excludes other HTML entries', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/\/admin\/v1|\/api\//.test(request.url())) requests.push(request.url());
  });
  const response = await page.goto('http://localhost:4176/');
  await expect(page.getByRole('heading', { name: 'Staff access is unavailable' })).toBeVisible();
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  expect(response?.headers()['cache-control']).toBe('no-store');
  expect(response?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect((await page.request.get('http://localhost:4176/index.html')).status()).toBe(404);
  expect((await page.request.get('http://localhost:4176/overlay.html')).status()).toBe(404);
  expect(requests).toHaveLength(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('strips invitation proof before reads and requires a deliberate pinned sign-in', async ({
  page,
}) => {
  const fixtureState = state();
  await mock(page, fixtureState);
  await page.route('http://127.0.0.1:3321/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>Synthetic identity provider</title><h1>Synthetic identity provider</h1>',
    }),
  );
  await page.goto(fixture + '?view=enrol#invitation=' + proof);
  await expect(page.getByRole('heading', { name: 'You’ve been invited' })).toBeVisible();
  expect(fixtureState.cleanAtRead).toBe(true);
  expect(fixtureState.writes).toHaveLength(0);
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.locator('body')).not.toContainText(proof);
  await page.getByRole('button', { name: 'Continue to staff sign-in' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic identity provider' })).toBeVisible();
  expect(fixtureState.writes).toHaveLength(1);
  expect(fixtureState.writes[0]?.body).toMatchObject({ invitationSecret: proof });
  expect(fixtureState.writes[0]?.csrf).toBeUndefined();
});
test('verifies leading-zero code, reviews the role and accepts once with the independent staff proof', async ({
  page,
}) => {
  const fixtureState = state();
  fixtureState.pending = pending();
  await mock(page, fixtureState);
  await page.goto(fixture);
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const code = page.getByLabel(/Email verification code/);
  await code.fill('00001234');
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your invitation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept staff invitation' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page
    .getByRole('button', { name: 'Accept staff invitation' })
    .evaluate((element: HTMLButtonElement) => {
      element.click();
      element.click();
    });
  await expect(page.getByRole('heading', { name: 'You’re signed in' })).toBeVisible();
  expect(fixtureState.writes.filter((value) => value.path.endsWith('/accept'))).toHaveLength(1);
  expect(fixtureState.writes.find((value) => value.path.endsWith('/verify'))?.body).toEqual({
    code: '00001234',
  });
  expect(fixtureState.writes.every((value) => value.csrf === proof)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // This isolated fixture rewrites its URL on the shared acceptance host.
  // Reload of the separate product entry is qualified against the actual API.
  await page.goto(fixture);
  await expect(page.getByRole('heading', { name: 'You’re signed in' })).toBeVisible();
});
test('keeps rejected code honest, clears its draft and supports explicit resend/cancel', async ({
  page,
}) => {
  const fixtureState = state();
  fixtureState.pending = pending();
  fixtureState.wrong = true;
  await mock(page, fixtureState);
  await page.goto(fixture);
  await page.getByLabel(/Email verification code/).fill('12345678');
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be verified');
  await expect(page.getByLabel(/Email verification code/)).toHaveValue('');
  await page.getByRole('button', { name: 'Send a new code' }).click();
  await expect(page.getByRole('status')).toContainText('A new code has been sent');
  await page.getByRole('button', { name: 'Cancel verification' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Darve staff' })).toBeVisible();
  expect(fixtureState.writes.map((value) => value.path.split('/').pop())).toEqual([
    'verify',
    'resend',
    'cancel',
  ]);
});
test('expires pending authority and clears role after a revoked-session read', async ({ page }) => {
  const fixtureState = state();
  fixtureState.pending = { ...pending(), expiresAt: new Date(Date.now() + 1500).toISOString() };
  await mock(page, fixtureState);
  await page.goto(fixture);
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your staff access expired' })).toBeVisible();
  fixtureState.pending = null;
  fixtureState.session = authenticated();
  await page.getByRole('button', { name: 'Check staff access' }).click();
  await expect(page.getByRole('heading', { name: 'You’re signed in' })).toBeVisible();
  fixtureState.session = null;
  await page.getByRole('button', { name: 'Check staff access' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Darve staff' })).toBeVisible();
  await expect(page.getByText('Support', { exact: true })).toHaveCount(0);
  expect(fixtureState.writes).toHaveLength(0);
});
test('supports the complete code/enrollment flow from the keyboard with reduced motion', async ({
  page,
}) => {
  const fixtureState = state();
  fixtureState.pending = pending();
  await mock(page, fixtureState);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fixture);
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel(/Email verification code/)).toBeFocused();
  await page.keyboard.type('00001234');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Verify code', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Review your invitation' })).toBeFocused();
  // The heading changes with the canonical phase; the verify command releases its busy fence next.
  await expect(page.getByRole('checkbox')).toBeEnabled();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox')).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Accept staff invitation' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'You’re signed in' })).toBeVisible();
});

test('a peer sign-out clears the shared staff session without replaying a command', async ({
  page,
  context,
}) => {
  const fixtureState = state();
  fixtureState.session = authenticated();
  await mock(page, fixtureState);
  await page.goto(fixture);
  await expect(page.getByRole('heading', { name: 'You’re signed in' })).toBeVisible();
  const peer = await context.newPage();
  await mock(peer, fixtureState);
  await peer.goto(fixture);
  await expect(peer.getByRole('heading', { name: 'You’re signed in' })).toBeVisible();
  await peer.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(peer.getByRole('heading', { name: 'Sign in to Darve staff' })).toBeVisible();
  await page.bringToFront();
  await expect(page.getByRole('heading', { name: 'Sign in to Darve staff' })).toBeVisible();
  expect(fixtureState.writes.filter((value) => value.path.endsWith('/logout'))).toHaveLength(1);
  await peer.close();
});

test('holds an uncertain sign-out closed until deliberate retry confirms it', async ({ page }) => {
  const fixtureState = state();
  fixtureState.session = authenticated();
  fixtureState.logoutLost = true;
  await mock(page, fixtureState);
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign-out isn’t confirmed' })).toBeVisible();
  await page.goto(fixture);
  await expect(page.getByRole('heading', { name: 'Sign-out isn’t confirmed' })).toBeVisible();
  await expect(page.getByText('Support', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check staff access' }).click();
  await expect(page.getByRole('heading', { name: 'Sign-out isn’t confirmed' })).toBeVisible();
  fixtureState.logoutLost = false;
  await page.getByRole('button', { name: 'Retry sign-out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Darve staff' })).toBeVisible();
  expect(fixtureState.writes).toHaveLength(2);
});
