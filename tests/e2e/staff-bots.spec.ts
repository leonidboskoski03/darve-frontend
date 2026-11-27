import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  ids,
  envelope,
  session,
  problem,
} from '../../src/services/staff-coins/fixture.test-helper';

for (const interrupted of [false, true]) {
  test(`owner reviews a bot refresh and revoke independently of coin access (interrupted: ${interrupted})`, async ({
    page,
  }) => {
    const writes: { path: string; body: Record<string, unknown>; key?: string }[] = [];
    let revoked = false;
    await page.route('http://127.0.0.1:3320/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const send = (data: unknown, status = 200) =>
        route.fulfill({
          status,
          headers: {
            'content-type': 'application/json',
            'Access-Control-Allow-Origin': 'http://127.0.0.1:4175',
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Allow-Headers': 'Content-Type,X-Staff-CSRF,Idempotency-Key',
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          },
          body: JSON.stringify(data),
        });
      if (request.method() === 'OPTIONS') return send({});
      if (path === '/admin/v1/session')
        return send(envelope({ ...session(), permissions: ['bots.read', 'bots.write'] }));
      if (path === '/admin/v1/auth/email-code') return send(problem('UNAUTHENTICATED'), 401);
      if (path === '/admin/v1/bots' && request.method() === 'GET')
        return send(
          envelope({
            items: ['TWITCH', 'YOUTUBE', 'KICK'].map((provider) => ({
              provider,
              authorizationId: provider === 'TWITCH' ? ids.creator : null,
              revision: revoked ? 2 : 1,
              connected: provider === 'TWITCH' && !revoked,
              actorKind: provider === 'TWITCH' ? 'DARVE_BOT' : null,
              channelName: provider === 'TWITCH' ? 'Synthetic posting account' : null,
              expiresAt: null,
              scopes:
                provider === 'TWITCH' && !revoked
                  ? ['user:bot', 'user:write:chat', 'moderator:manage:chat_messages']
                  : [],
              pinPermission: provider === 'TWITCH' && !revoked,
              lastOutcome: revoked ? 'revoke:provider_failed' : null,
              checkedAt: null,
              commandState: interrupted && provider === 'TWITCH' && !revoked ? 'uncertain' : null,
            })),
          }),
        );
      if (request.method() === 'POST' && path.startsWith('/admin/v1/bots/')) {
        const action = path.endsWith('/refresh') ? 'refresh' : 'revoke';
        writes.push({
          path,
          body: request.postDataJSON() as Record<string, unknown>,
          key: request.headers()['idempotency-key'],
        });
        revoked = action === 'revoke';
        return send(
          envelope({
            authorizationId: ids.creator,
            commandId: ids.ticket,
            action,
            state: revoked ? 'revoked' : 'queued',
            revision: revoked ? 2 : 1,
          }),
        );
      }
      return send(problem('NOT_FOUND'), 404);
    });
    await page.goto('http://127.0.0.1:4175/tests/fixtures/staff-coins.html?view=bots');
    await expect(page.getByRole('heading', { name: 'DarveBot accounts' })).toBeVisible();
    for (const provider of ['Twitch', 'YouTube', 'Kick'])
      await expect(page.getByRole('heading', { name: provider, exact: true })).toBeVisible();
    await page.getByLabel('TWITCH change reason').fill('Synthetic account maintenance');
    await page.getByRole('button', { name: 'Review refresh TWITCH' }).click();
    await expect(page.getByRole('button', { name: 'Confirm bot change' })).toBeDisabled();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Confirm bot change' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'server recorded' })).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toMatchObject({
      expectedRevision: 1,
      reason: 'Synthetic account maintenance',
      confirmation: { authorizationId: ids.creator },
    });
    expect(writes[0].key).toBeTruthy();
    await page.getByLabel('TWITCH change reason').fill('Synthetic account revocation');
    await page.getByRole('button', { name: 'Review revoke TWITCH' }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Confirm bot change' }).click();
    await expect(page.getByText('Not connected · DarveBot', { exact: true })).toBeVisible();
    await expect(page.getByText('revoke:provider_failed', { exact: true }).first()).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1].key).not.toBe(writes[0].key);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
