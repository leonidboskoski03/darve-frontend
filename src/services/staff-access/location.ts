const paths = new Set(['/', '/staff/enrol', '/tickets', '/reviews', '/coins']);
const entryPaths = new Set([...paths, '/staff/verify-email']);
export function staffCoinSearch(search: string) {
  if (search.length > 2048) return '';
  const input = new URLSearchParams(search),
    output = new URLSearchParams();
  const unique = (name: string) => (input.getAll(name).length === 1 ? input.get(name) : null);
  const view = unique('view'),
    owner = unique('owner'),
    template = unique('template');
  if (view && ['configuration', 'account', 'prices'].includes(view)) output.set('view', view);
  if (
    owner &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(owner)
  )
    output.set('owner', owner.toLowerCase());
  if (template && /^[a-z][a-z0-9_-]{0,63}$/.test(template)) output.set('template', template);
  return output.size ? '?' + output.toString() : '';
}
/** Preserve only public staff-tool navigation filters; proofs and arbitrary query fields are stripped. */
export function staffReviewSearch(search: string) {
  if (search.length > 2048) return '';
  const input = new URLSearchParams(search),
    output = new URLSearchParams();
  const unique = (name: string) => (input.getAll(name).length === 1 ? input.get(name) : null);
  const view = unique('view');
  if (view && ['challenges', 'challenge', 'streamer', 'reviews', 'staff', 'audit'].includes(view))
    output.set('view', view);
  for (const key of ['id', 'owner']) {
    const value = unique(key);
    if (
      value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    )
      output.set(key, value);
  }
  const state = unique('state');
  if (state && ['open', 'in_review', 'resolved'].includes(state)) output.set('state', state);
  return output.size ? '?' + output.toString() : '';
}
export function staffReturnPath(path: string) {
  return paths.has(path) ? path : '/';
}

/** Capture a one-use invitation before mounting; callers always strip query and fragment. */
export function readStaffEntry(href: string) {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const proof = fragment.get('invitation');
  const valid =
    url.pathname === '/staff/enrol' &&
    !url.search &&
    fragment.size === 1 &&
    fragment.getAll('invitation').length === 1 &&
    proof !== null &&
    /^[A-Za-z0-9_-]{43}$/.test(proof);
  return {
    path:
      entryPaths.has(url.pathname) ||
      /^\/tickets\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        url.pathname,
      )
        ? url.pathname
        : '/',
    invitation: valid ? proof : null,
    invitationInvalid: Boolean(url.hash) && !valid,
  };
}
export function isStaffAuthorizationUrl(value: string, endpoint: string, apiOrigin: string) {
  try {
    const url = new URL(value),
      allowed = new URL(endpoint);
    return (
      value.length <= 16384 &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.origin === allowed.origin &&
      url.pathname === allowed.pathname &&
      ['state', 'nonce', 'code_challenge'].every(
        (key) =>
          url.searchParams.getAll(key).length === 1 &&
          /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get(key) ?? ''),
      ) &&
      [
        ['redirect_uri', apiOrigin + '/admin/v1/auth/callback'],
        ['response_type', 'code'],
        ['code_challenge_method', 'S256'],
        ['prompt', 'login'],
        ['max_age', '0'],
      ].every(
        ([key, expected]) =>
          url.searchParams.getAll(key!).length === 1 && url.searchParams.get(key!) === expected,
      )
    );
  } catch {
    return false;
  }
}
