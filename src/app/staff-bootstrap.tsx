import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { createStaffRouter } from '@/routes/staff';
import { createStaffAccess, readStaffEntry } from '@/services/staff-access/index';
import '@/design-system/styles.css';

export function mountStaffAccess(configuration: {
  appEnv: 'local' | 'staging' | 'production';
  apiOrigin?: string;
  authorizationEndpoint?: string;
}) {
  const entry = readStaffEntry(window.location.href);
  // Strip every query/fragment before mounting or making any authority request.
  window.history.replaceState(null, '', entry.path);
  let returnTo: (path: string) => void = () => {};
  const access = createStaffAccess({
    origin: configuration.apiOrigin,
    authorizationEndpoint: configuration.authorizationEndpoint,
    frontendOrigin: window.location.origin,
    appEnv: configuration.appEnv,
    invitation: entry.invitation,
    invitationInvalid: entry.invitationInvalid,
    returnPath: entry.path,
    navigateReturn: (path) => returnTo(path),
  });
  entry.invitation = null;
  const router = createStaffRouter(access);
  returnTo = (path) => {
    void router.navigate(path, { replace: true });
  };
  const element = document.getElementById('root');
  if (!element) throw new Error('Staff root is missing.');
  const root = createRoot(element);
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  access.start();
  const hide = () => access.stop();
  const show = (event: PageTransitionEvent) => {
    if (event.persisted) access.start();
  };
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', show);
  return () => {
    access.stop();
    router.dispose();
    root.unmount();
    window.removeEventListener('pagehide', hide);
    window.removeEventListener('pageshow', show);
  };
}
