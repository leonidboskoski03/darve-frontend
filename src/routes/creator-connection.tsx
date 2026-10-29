import { useContext, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { CreatorAccess } from '@/features/creator-access/index';
import { CreatorSessionContext, useCreatorSession } from '@/features/session-status/index';
import { oauthReturnNotice } from '@/services/identity-navigation/index';

function Configured({ mode, origin }: { mode: 'connect' | 'terms'; origin: string }) {
  const { controller: session, snapshot } = useCreatorSession();
  const { search } = useLocation();
  return (
    <CreatorAccess
      runtime={{ origin, session, snapshot }}
      notice={
        ['authenticated', 'signed_out', 'expired'].includes(snapshot.phase)
          ? oauthReturnNotice(search, snapshot.phase === 'authenticated')
          : null
      }
      mode={mode}
    />
  );
}
export function Component() {
  const creator = useContext(CreatorSessionContext);
  const { pathname } = useLocation();
  const mode = pathname === '/terms' ? 'terms' : 'connect';
  useEffect(() => {
    document.title = mode === 'terms' ? 'Account terms — Darve' : 'Connect your stream — Darve';
  }, [mode]);
  return creator?.origin ? (
    <Configured mode={mode} origin={creator.origin} />
  ) : (
    <CreatorAccess runtime={null} notice={null} mode={mode} />
  );
}
