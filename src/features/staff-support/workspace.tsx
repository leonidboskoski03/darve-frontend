import { useMemo } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import { Brand } from '@/design-system/brand';
import { createStaffSupportClient } from '@/services/staff-support/index';
import type { StaffAccess } from '@/services/staff-access/index';
import { StaffDesk } from './desk';
import { StaffThread } from './thread';
import './workspace.css';
export function StaffWorkspace({
  access,
  id,
  onOpen,
  onList,
}: {
  access: StaffAccess;
  id?: string | undefined;
  onOpen: (id: string) => void;
  onList: () => void;
}) {
  const client = useMemo(() => createStaffSupportClient(access), [access]);
  return (
    <QueryClientProvider client={client.scope.queryClient}>
      <div className="staff-work-shell">
        <a className="skip-link" href="#staff-work-main">
          Skip to staff work
        </a>
        <header className="staff-work-topbar">
          <Brand />
          <span>
            Staff support ·{' '}
            {access.getSnapshot().role === 'OWNER_ADMIN' ? 'Owner administrator' : 'Support'}
          </span>
          <nav aria-label="Staff workspace">
            {access.getSnapshot().permissions.includes('coins.read') ? (
              <a href="/coins">Coin tools</a>
            ) : null}
            {access.getSnapshot().permissions.includes('review.read') ? (
              <a href="/reviews">Inspection and reviews</a>
            ) : null}
            <Button tone="quiet" onClick={onList}>
              Support desk
            </Button>
            <a href="/">Staff access</a>
            <Button tone="secondary" onClick={() => void access.logout()}>
              Sign out
            </Button>
          </nav>
        </header>
        <main id="staff-work-main" tabIndex={-1}>
          {id ? (
            <StaffThread key={id} client={client} id={id} onList={onList} />
          ) : (
            <StaffDesk client={client} onOpen={onOpen} />
          )}
        </main>
      </div>
    </QueryClientProvider>
  );
}
