import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { StaffAccess } from '@/services/staff-access/index';
import { StaffAccessScreen } from '@/features/staff-access/index';
import { StaffWorkspace } from '@/features/staff-support/index';
export function StaffWorkRoute({ access }: { access: StaffAccess }) {
  const snapshot = useSyncExternalStore(access.subscribe, access.getSnapshot, access.getSnapshot);
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const list = useCallback(() => {
    void navigate('/tickets');
  }, [navigate]);
  const open = useCallback(
    (id: string) => {
      void navigate('/tickets/' + id);
    },
    [navigate],
  );
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.title = ticketId ? 'Support ticket — Darve staff' : 'Support desk — Darve staff';
    wrapper.current?.querySelector<HTMLElement>('main')?.focus();
  }, [ticketId]);
  if (snapshot.phase !== 'authenticated' || snapshot.error?.code === 'REAUTHENTICATION_REQUIRED')
    return <StaffAccessScreen access={access} />;
  if (!snapshot.permissions.includes('tickets.assigned.read'))
    return <StaffAccessScreen access={access} />;
  return (
    <div ref={wrapper}>
      <StaffWorkspace
        key={snapshot.scope.id}
        access={access}
        id={ticketId}
        onList={list}
        onOpen={open}
      />
    </div>
  );
}
