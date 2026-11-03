import { createBrowserRouter } from 'react-router-dom';
import type { StaffAccess } from '@/services/staff-access/index';

export function createStaffRouter(access: StaffAccess) {
  const lazy = async () => {
    const { StaffAccessScreen } = await import('@/features/staff-access/index');
    return {
      Component: function StaffRoute() {
        return <StaffAccessScreen access={access} />;
      },
    };
  };
  const work = async () => {
    const { StaffWorkRoute } = await import('./staff-support');
    return {
      Component: function StaffSupportRoute() {
        return <StaffWorkRoute access={access} />;
      },
    };
  };
  const administration = async () => {
    const { StaffAdminRoute } = await import('./staff-admin');
    return {
      Component: function StaffAdministrationRoute() {
        return <StaffAdminRoute access={access} />;
      },
    };
  };
  return createBrowserRouter(
    ['/', '/staff/enrol', '/staff/verify-email', '/tickets', '/tickets/:ticketId', '/reviews'].map(
      (path) => ({
        path,
        lazy: path.startsWith('/tickets') ? work : path === '/reviews' ? administration : lazy,
        hydrateFallbackElement: (
          <main className="staff-shell">
            <p role="status">Checking staff access…</p>
          </main>
        ),
        errorElement: (
          <main>
            <h1>Staff access is unavailable</h1>
            <p>The staff page could not be loaded.</p>
            <a href="/">Reload staff access</a>
          </main>
        ),
      }),
    ),
  );
}
