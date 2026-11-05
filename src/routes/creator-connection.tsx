import { useContext, useEffect } from 'react';
import { Navigate, useLocation, useMatch } from 'react-router-dom';
import { CreatorAccess } from '@/features/creator-access/index';
import { CreatorSessionContext, useCreatorSession } from '@/features/session-status/index';
import { oauthReturnNotice, oauthReturnSearch } from '@/services/identity-navigation/index';

function Configured({ mode, origin }: { mode: 'connect' | 'terms'; origin: string }) {
  const { controller: session, snapshot } = useCreatorSession();
  const { search } = useLocation();
  const signInEntry = useMatch('/authorize');
  if (signInEntry && snapshot.phase === 'authenticated')
    return <Navigate replace to={{ pathname: '/onboarding', search: oauthReturnSearch(search) }} />;
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
  const mode = useMatch('/terms') ? 'terms' : 'connect';
  useEffect(() => {
    document.title = mode === 'terms' ? 'Account terms — Darve' : 'Connect your stream — Darve';
  }, [mode]);
  return creator?.origin ? (
    <Configured mode={mode} origin={creator.origin} />
  ) : (
    <CreatorAccess runtime={null} notice={null} mode={mode} />
  );
}
