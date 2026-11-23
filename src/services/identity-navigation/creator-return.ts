const key = 'darve-creator-return';
const privatePath =
  /^\/(?:dashboard|account(?:\/payments)?|obs|coins|templates|onboarding|integrations|terms|support(?:\/[\w-]+)?|challenges(?:\/[\w-]+)?|collection(?:\/[\w-]+(?:\/(?:suggestions|analytics))?)?)\/?$/i;
const privateParameter =
  /^(?:token|access_token|id_token|refresh_token|code|state|grant|grantId|error_description)$/i;
const base = 'https://darve.invalid';

export function safeCreatorReturn(value: string | null): string | null {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    [...value].some((character) => character.charCodeAt(0) <= 32)
  )
    return null;
  const url = new URL(value, base);
  if (url.origin !== base || !privatePath.test(url.pathname)) return null;
  for (const name of [...url.searchParams.keys()]) {
    if (privateParameter.test(name)) url.searchParams.delete(name);
  }
  if (
    [...new URLSearchParams(url.hash.slice(1)).keys()].some((name) => privateParameter.test(name))
  )
    url.hash = '';
  return url.pathname + url.search + url.hash;
}

export function rememberCreatorReturn(path: string | null) {
  try {
    if (path) sessionStorage.setItem(key, path);
    else sessionStorage.removeItem(key);
  } catch {
    // Sign-in still works if the browser does not permit tab storage.
  }
}

export function storedCreatorReturn() {
  try {
    return safeCreatorReturn(sessionStorage.getItem(key));
  } catch {
    return null;
  }
}
