import { useContext } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { safeCreatorReturn } from '@/services/identity-navigation/index';
import { CreatorAccess } from '@/features/creator-access/index';
import { CreatorSessionContext, useCreatorSession } from '@/features/session-status/index';

function Configured({ origin }: { origin: string }) {
  const { controller, snapshot } = useCreatorSession();
  const { pathname, search, hash } = useLocation();
  if (snapshot.phase === 'authenticated') return <Outlet />;
  if (snapshot.phase === 'signed_out' || snapshot.phase === 'expired') {
    const returnTo = safeCreatorReturn(pathname + search + hash);
    return (
      <Navigate
        replace
        to={returnTo ? '/authorize?' + new URLSearchParams({ returnTo }).toString() : '/authorize'}
      />
    );
  }
  return (
    <CreatorAccess
      runtime={{ origin, session: controller, snapshot }}
      mode="connect"
      notice={null}
    />
  );
}

export function CreatorGuard() {
  const session = useContext(CreatorSessionContext);
  return session?.origin ? (
    <Configured origin={session.origin} />
  ) : (
    <CreatorAccess runtime={null} mode="connect" notice={null} />
  );
}
