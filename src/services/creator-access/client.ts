import {
  OAuthProviderSchema,
  OAuthStartInputSchema,
  AuthorizationStartSchema,
  TermsDocumentResponseSchema,
  TermsAcceptanceInputSchema,
  TermsAcceptanceResponseSchema,
  ConnectionsResponseSchema,
  ConnectionsQuerySchema,
  ConnectionUnlinkInputSchema,
  ConnectionSchema,
  type OAuthStartInput,
} from '@/services/contracts/index';
import { createJsonClient, failure, type ApiFailure, type ApiResult } from '@/services/api/index';
import type { CreatorSession } from '@/services/creator-session/index';

export type Provider = ReturnType<typeof OAuthProviderSchema.parse>;
export type Connection = ReturnType<
  typeof ConnectionsResponseSchema.parse
>['data']['items'][number];
export type TermsDocument = ReturnType<typeof TermsDocumentResponseSchema.parse>['data'];
export class CreatorAccessError extends Error {
  constructor(readonly problem: ApiFailure) {
    super('The request could not be confirmed.');
  }
}
const requireData = <T>(result: ApiResult<T>) => {
  if (result.kind === 'data') return result.data;
  throw new CreatorAccessError(
    result.kind === 'error' ? result : failure('protocol', 'UNEXPECTED_RESPONSE'),
  );
};
const destinations: Record<Provider, string> = {
  twitch: 'https://id.twitch.tv/oauth2/authorize',
  youtube: 'https://accounts.google.com/o/oauth2/v2/auth',
  kick: 'https://id.kick.com/oauth/authorize',
};
export function isProviderAuthorizationUrl(provider: Provider, input: string) {
  try {
    const url = new URL(input),
      expected = new URL(destinations[provider]);
    return (
      url.origin === expected.origin &&
      url.pathname === expected.pathname &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/** Consumes authorization URLs inside the service; none enter React/Query state or storage. */
export function createCreatorAccessClient(options: {
  origin: string;
  session: CreatorSession;
  navigate?: (url: string) => void;
  fetcher?: typeof fetch;
  now?: () => number;
}) {
  const { session } = options;
  if (options.origin !== session.origin)
    throw new CreatorAccessError(failure('configuration', 'INVALID_CREATOR_ORIGIN'));
  let authorizing = false;
  return {
    async authorize(provider: Provider, input: OAuthStartInput): Promise<'redirecting'> {
      const providerValue = OAuthProviderSchema.safeParse(provider),
        body = OAuthStartInputSchema.safeParse(input);
      if (!providerValue.success || !body.success || body.data.returnPath !== '/integrations')
        throw new CreatorAccessError(failure('configuration', 'INVALID_AUTHORIZATION_REQUEST'));
      if (authorizing)
        throw new CreatorAccessError(failure('authority', 'AUTHORIZATION_IN_PROGRESS'));
      const current = session.getSnapshot(),
        scope = current.scope;
      if (
        current.phase !== 'authenticated' &&
        !(input.intent === 'sign_in' && ['signed_out', 'expired'].includes(current.phase))
      )
        throw new CreatorAccessError(failure('authority', 'CREATOR_SESSION_REQUIRED'));
      authorizing = true;
      let redirected = false;
      try {
        const request = {
          path: `/api/auth/${providerValue.data}/start`,
          method: 'POST' as const,
          body: body.data,
          schema: AuthorizationStartSchema,
          success: [200] as const,
        };
        const result =
          current.phase === 'authenticated'
            ? await session.request(request)
            : await createJsonClient({
                origin: options.origin,
                audience: 'creator',
                lifetime: scope.signal,
                fetcher: options.fetcher,
              })(request);
        const data = requireData(result);
        if (scope.signal.aborted)
          throw new CreatorAccessError(failure('cancelled', 'AUTHORITY_CHANGED'));
        if (
          !isProviderAuthorizationUrl(providerValue.data, data.authorizationUrl) ||
          Date.parse(data.expiresAt) <= (options.now ?? Date.now)()
        )
          throw new CreatorAccessError(failure('protocol', 'INVALID_AUTHORIZATION_RESPONSE'));
        (options.navigate ?? ((url) => window.location.assign(url)))(data.authorizationUrl);
        redirected = true;
        return 'redirecting';
      } finally {
        if (!redirected) authorizing = false;
      }
    },
    async terms(signal: AbortSignal) {
      return requireData(
        await session.request({
          path: '/api/terms/current',
          schema: TermsDocumentResponseSchema,
          success: [200],
          signal,
        }),
      ).data;
    },
    async acceptTerms(input: unknown) {
      const parsed = TermsAcceptanceInputSchema.safeParse(input);
      if (!parsed.success)
        throw new CreatorAccessError(failure('configuration', 'INVALID_TERMS_ACCEPTANCE'));
      return requireData(
        await session.request({
          path: '/api/terms/acceptance',
          method: 'POST',
          body: parsed.data,
          schema: TermsAcceptanceResponseSchema,
          success: [200],
        }),
      ).data;
    },
    async connections(cursor: string | null, signal: AbortSignal) {
      const parsed = ConnectionsQuerySchema.safeParse({
        limit: '100',
        ...(cursor ? { cursor } : {}),
      });
      if (!parsed.success)
        throw new CreatorAccessError(failure('configuration', 'INVALID_CONNECTION_CURSOR'));
      const query = new URLSearchParams({
        limit: String(parsed.data.limit),
        ...(cursor ? { cursor } : {}),
      });
      return requireData(
        await session.request({
          path: '/api/connections?' + query.toString(),
          schema: ConnectionsResponseSchema,
          success: [200],
          signal,
        }),
      ).data;
    },
    async unlink(connection: Pick<Connection, 'id' | 'version'>) {
      const parsed = ConnectionUnlinkInputSchema.safeParse({ expectedVersion: connection.version });
      // IDs are public contract UUIDs; never interpolate a caller-controlled path.
      const id = ConnectionSchema.shape.id.safeParse(connection.id);
      if (!parsed.success || !id.success)
        throw new CreatorAccessError(failure('configuration', 'INVALID_CONNECTION'));
      const result = await session.request({
        path: `/api/connections/${connection.id}`,
        method: 'DELETE',
        body: parsed.data,
        schema: ConnectionsResponseSchema,
        success: [204],
      });
      if (result.kind !== 'empty')
        throw new CreatorAccessError(
          result.kind === 'error' ? result : failure('protocol', 'INVALID_UNLINK_RESPONSE'),
        );
      // Backend may have ended this session. Reinspect before presenting any private state.
      await session.inspect();
    },
  };
}
export type CreatorAccessClient = ReturnType<typeof createCreatorAccessClient>;
