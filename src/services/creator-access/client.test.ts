import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCreatorSession, type CreatorSession } from '@/services/creator-session/index';
import {
  createCreatorAccessClient,
  CreatorAccessError,
  isProviderAuthorizationUrl,
} from './client';

const origin = 'https://api.example.test';
const signedIn = {
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
const signedOut = { authenticated: false, user: null, expiresAt: null, csrfToken: null };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const active: CreatorSession[] = [];
async function setup(authenticated = true) {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(authenticated ? signedIn : signedOut));
  const session = createCreatorSession({ origin, fetcher: send });
  active.push(session);
  session.start();
  await session.inspect();
  const navigate = vi.fn();
  return {
    session,
    send,
    navigate,
    client: createCreatorAccessClient({ origin, session, fetcher: send, navigate }),
  };
}
afterEach(() => {
  active.forEach((session) => session.stop());
  active.length = 0;
});
const signIn = { intent: 'sign_in', returnPath: '/integrations', connectionId: null } as const;

describe('creator API and authorization boundary', () => {
  it.each([
    ['twitch', 'https://id.twitch.tv/oauth2/authorize'],
    ['youtube', 'https://accounts.google.com/o/oauth2/v2/auth'],
    ['kick', 'https://id.kick.com/oauth/authorize'],
  ] as const)(
    'consumes a real-shaped %s start response without exposing its URL to Query/React state',
    async (provider, destination) => {
      const { client, send, navigate } = await setup(false);
      const url = destination + '?state=synthetic-state&response_type=code';
      send.mockResolvedValueOnce(
        json({ authorizationUrl: url, expiresAt: '2030-01-01T00:00:00.000Z' }),
      );
      expect(await client.authorize(provider, signIn)).toBe('redirecting');
      expect(navigate).toHaveBeenCalledWith(url);
      expect(send.mock.calls[1]?.[0]).toBe(`${origin}/api/auth/${provider}/start`);
      expect(JSON.parse(send.mock.calls[1]?.[1]?.body as string)).toEqual(signIn);
      expect(new Headers(send.mock.calls[1]?.[1]?.headers).has('X-CSRF-Token')).toBe(false);
    },
  );
  it('includes current creator CSRF even for sign-in when a session already exists', async () => {
    const { client, send } = await setup();
    send.mockResolvedValueOnce(
      json({
        authorizationUrl: 'https://id.twitch.tv/oauth2/authorize?state=synthetic',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }),
    );
    await client.authorize('twitch', signIn);
    expect(new Headers(send.mock.calls[1]?.[1]?.headers).get('X-CSRF-Token')).toBe(
      signedIn.csrfToken,
    );
  });
  it.each([
    'https://id.twitch.tv.evil.test/oauth2/authorize',
    'https://id.twitch.tv@evil.test/oauth2/authorize',
    'https://id.twitch.tv/oauth2/authorize/extra',
    'https://id.twitch.tv:444/oauth2/authorize',
    'https://user:pass@id.twitch.tv/oauth2/authorize',
    'https://id.twitch.tv/oauth2/authorize#proof',
    'http://id.twitch.tv/oauth2/authorize',
    'javascript:alert(1)',
  ])('rejects a foreign or malformed authorization destination without navigating', (url) => {
    expect(isProviderAuthorizationUrl('twitch', url)).toBe(false);
  });
  it('does not navigate after an authority change, even if the old fetch ignores cancellation', async () => {
    const { client, session, send, navigate } = await setup(false);
    let resolve!: (response: Response) => void;
    send.mockReturnValueOnce(
      new Promise((finish) => {
        resolve = finish;
      }),
    );
    const attempt = client.authorize('twitch', signIn);
    const rejected = expect(attempt).rejects.toBeInstanceOf(CreatorAccessError);
    session.stop();
    resolve(
      json({
        authorizationUrl: 'https://id.twitch.tv/oauth2/authorize?state=synthetic',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }),
    );
    await rejected;
    expect(navigate).not.toHaveBeenCalled();
  });
  it('deduplicates pending authorization across provider buttons and preserves explicit reauthorization purpose', async () => {
    const { client, send } = await setup();
    let resolve!: (response: Response) => void;
    send.mockReturnValueOnce(
      new Promise((finish) => {
        resolve = finish;
      }),
    );
    const attempt = client.authorize('twitch', {
      intent: 'reauthorize',
      returnPath: '/integrations',
      connectionId: signedIn.user.id,
      authorizationPurpose: 'bot_destination',
    });
    await expect(client.authorize('youtube', signIn)).rejects.toMatchObject({
      problem: { code: 'AUTHORIZATION_IN_PROGRESS' },
    });
    resolve(
      json({
        authorizationUrl: 'https://id.twitch.tv/oauth2/authorize?state=synthetic',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }),
    );
    await attempt;
    await expect(client.authorize('twitch', signIn)).rejects.toMatchObject({
      problem: { code: 'AUTHORIZATION_IN_PROGRESS' },
    });
    expect(JSON.parse(send.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      authorizationPurpose: 'bot_destination',
    });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('rejects expired starts and unsafe return paths without exposing navigation payloads', async () => {
    const { client, send, navigate } = await setup(false);
    await expect(
      client.authorize('twitch', { ...signIn, returnPath: '//evil.test' }),
    ).rejects.toBeInstanceOf(CreatorAccessError);
    expect(send).toHaveBeenCalledOnce();
    send.mockResolvedValueOnce(
      json({
        authorizationUrl: 'https://id.twitch.tv/oauth2/authorize',
        expiresAt: '2020-01-01T00:00:00.000Z',
      }),
    );
    await expect(client.authorize('twitch', signIn)).rejects.toMatchObject({
      problem: { category: 'protocol' },
    });
    expect(navigate).not.toHaveBeenCalled();
  });
  it('never automatically replays an uncertain authorization request', async () => {
    const { client, send, navigate } = await setup(false);
    send.mockRejectedValueOnce(new Error('private-provider-marker'));
    await expect(client.authorize('kick', signIn)).rejects.toMatchObject({
      problem: { category: 'network' },
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('submits only the exact displayed terms identity/hash and requires explicit acceptance', async () => {
    const { client, send } = await setup();
    const input = {
      documentId: 'synthetic-local',
      version: 'local-1',
      contentHash: 'b'.repeat(64),
      accepted: true,
    };
    await expect(client.acceptTerms({ ...input, accepted: false })).rejects.toMatchObject({
      problem: { category: 'configuration' },
    });
    expect(send).toHaveBeenCalledOnce();
    send.mockResolvedValueOnce(
      json({
        schemaVersion: 1,
        serverTime: '2026-10-27T12:00:00.000Z',
        data: {
          status: 'accepted',
          documentId: input.documentId,
          requiredVersion: input.version,
          acceptedVersion: input.version,
          classification: 'development',
          contentHash: input.contentHash,
          acceptedAt: '2026-10-27T12:00:00.000Z',
        },
      }),
    );
    await client.acceptTerms(input);
    expect(JSON.parse(send.mock.calls[1]?.[1]?.body as string)).toEqual(input);
    expect(new Headers(send.mock.calls[1]?.[1]?.headers).get('X-CSRF-Token')).toBe(
      signedIn.csrfToken,
    );
  });
  it('validates unlink identity/version before sending and reinspects the session after empty 204', async () => {
    const { client, send, session } = await setup();
    await expect(client.unlink({ id: '../session', version: 1 })).rejects.toBeInstanceOf(
      CreatorAccessError,
    );
    expect(send).toHaveBeenCalledOnce();
    send
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json(signedOut));
    await client.unlink({ id: signedIn.user.id, version: 7 });
    expect(JSON.parse(send.mock.calls[1]?.[1]?.body as string)).toEqual({ expectedVersion: 7 });
    expect(send.mock.calls[2]?.[0]).toBe(origin + '/api/session');
    expect(session.getSnapshot().phase).toBe('signed_out');
  });
  it('rejects origin mismatch rather than sending creator flow to a different API', async () => {
    const { session } = await setup(false);
    expect(() => createCreatorAccessClient({ origin: 'https://other.test', session })).toThrow(
      CreatorAccessError,
    );
  });
});
