const providers = new Set(['twitch', 'youtube', 'kick']);

const results = new Set([
  'success',
  'cancelled',
  'authorization_failed',
  'invalid_attempt',
  'provider_unavailable',
  'account_conflict',
  'provider_error',
  'unconfirmed',
]);
export function sanitizeOAuthReturn(href: string): string | null {
  const url = new URL(href);
  if (!['/', '/authorize', '/integrations'].includes(url.pathname)) return null;
  const hasReturn = url.searchParams.has('oauth_result') || url.searchParams.has('oauth_provider');
  const hasSecret = [
    'code',
    'state',
    'access_token',
    'id_token',
    'refresh_token',
    'token',
    'error_description',
  ].some((key) => url.searchParams.has(key));
  const fragment = new URLSearchParams(url.hash.slice(1));
  const hasSecretFragment = [
    'access_token',
    'id_token',
    'refresh_token',
    'code',
    'state',
    'token',
  ].some((key) => fragment.has(key));
  if (!hasReturn && !hasSecret && !hasSecretFragment) return null;
  const provider = url.searchParams.get('oauth_provider');
  const value = url.searchParams.get('oauth_result');
  url.search = '';
  url.hash = '';
  if (hasReturn || hasSecret) {
    url.searchParams.set('oauth_result', value && results.has(value) ? value : 'unconfirmed');
    if (provider && providers.has(provider)) url.searchParams.set('oauth_provider', provider);
  }
  return url.pathname + url.search;
}

export function oauthReturnNotice(search: string, authenticated: boolean) {
  const query = new URLSearchParams(search);
  if (!query.has('oauth_result')) return null;
  const result = query.get('oauth_result');
  if (result === 'success')
    return authenticated
      ? 'Your account state has been refreshed.'
      : 'No signed-in session was established. Try connecting again.';
  if (result === 'cancelled')
    return 'Authorization was cancelled. You can try again when you are ready.';
  if (result === 'provider_unavailable')
    return 'This provider is unavailable on this server. You can choose another provider or try later.';
  if (result === 'account_conflict')
    return 'This provider account could not be connected to the current account. Check which account is signed in.';
  return 'The connection could not be confirmed. Check your session and try again.';
}
