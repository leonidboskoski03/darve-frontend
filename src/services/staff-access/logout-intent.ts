// Content-free, tab-local privacy intent. It blocks a workspace; it never grants authority.
const key = 'darve.staff.signout-pending.v1';
export function readLogoutIntent() {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
export function writeLogoutIntent(pending: boolean) {
  try {
    if (typeof window === 'undefined') return;
    if (pending) window.sessionStorage.setItem(key, '1');
    else window.sessionStorage.removeItem(key);
  } catch {
    /* The current in-memory hold still applies when storage is unavailable. */
  }
}
