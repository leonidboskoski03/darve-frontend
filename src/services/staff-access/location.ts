const paths = new Set(['/', '/staff/enrol', '/tickets', '/reviews']);
const entryPaths = new Set([...paths, '/staff/verify-email']);
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
    path: entryPaths.has(url.pathname) ? url.pathname : '/',
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
