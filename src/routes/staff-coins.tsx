import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StaffAccessScreen } from '@/features/staff-access/index';
import { StaffCoins, type CoinToolSelection } from '@/features/staff-coins/index';
import { staffCoinSearch, type StaffAccess } from '@/services/staff-access/index';
export function StaffCoinsRoute({ access }: { access: StaffAccess }) {
  const snapshot = useSyncExternalStore(access.subscribe, access.getSnapshot, access.getSnapshot),
    [search, setSearch] = useSearchParams(),
    wrapper = useRef<HTMLDivElement>(null);
  const safe = new URLSearchParams(staffCoinSearch('?' + search.toString()));
  const view = safe.get('view');
  const selection: CoinToolSelection = {
    view: view === 'account' || view === 'prices' ? view : 'configuration',
    owner: safe.get('owner') ?? '',
    template: safe.get('template') ?? '',
  };
  useEffect(() => {
    document.title = 'Coin administration — Darve staff';
    wrapper.current?.querySelector<HTMLElement>('main')?.focus();
  }, [selection.view, selection.owner, selection.template]);
  if (snapshot.phase !== 'authenticated' || snapshot.error?.code === 'REAUTHENTICATION_REQUIRED')
    return <StaffAccessScreen access={access} />;
  if (snapshot.role !== 'OWNER_ADMIN' || !snapshot.permissions.includes('coins.read'))
    return (
      <main>
        <h1>Coin tools unavailable</h1>
        <p>Current staff access does not allow owner coin tools.</p>
        <a href="/">Return to staff access</a>
      </main>
    );
  return (
    <div ref={wrapper}>
      <StaffCoins
        key={snapshot.scope.id}
        access={access}
        selection={selection}
        onSelect={(next) => {
          setSearch(staffCoinSearch('?' + new URLSearchParams(next).toString()));
        }}
      />
    </div>
  );
}
