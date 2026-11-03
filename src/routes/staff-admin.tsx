import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StaffAccessScreen } from '@/features/staff-access/index';
import { StaffAdminWorkspace } from '@/features/staff-admin/index';
import { staffReviewSearch, type StaffAccess } from '@/services/staff-access/index';
import type { AdminSelection, AdminView } from '@/services/staff-admin/index';
export function StaffAdminRoute({ access }: { access: StaffAccess }) {
  const snapshot = useSyncExternalStore(access.subscribe, access.getSnapshot, access.getSnapshot);
  const [search, setSearch] = useSearchParams();
  const normalized = new URLSearchParams(staffReviewSearch(search.toString()));
  const selection: AdminSelection = {
    view: (normalized.get('view') ?? 'reviews') as AdminView,
    id: normalized.get('id') ?? '',
    owner: normalized.get('owner') ?? '',
    state: normalized.get('state') ?? '',
  };
  const select = useCallback(
    (next: AdminSelection) => {
      setSearch(
        new URLSearchParams(staffReviewSearch(new URLSearchParams({ ...next }).toString())),
      );
    },
    [setSearch],
  );
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.title = 'Staff tools — Darve';
    wrapper.current?.querySelector<HTMLElement>('main')?.focus();
  }, [selection.view, selection.id]);
  if (snapshot.phase !== 'authenticated' || snapshot.error?.code === 'REAUTHENTICATION_REQUIRED')
    return <StaffAccessScreen access={access} />;
  if (!snapshot.permissions.includes('review.read')) return <StaffAccessScreen access={access} />;
  return (
    <div ref={wrapper}>
      <StaffAdminWorkspace
        key={snapshot.scope.id}
        access={access}
        selection={selection}
        onSelect={select}
      />
    </div>
  );
}
