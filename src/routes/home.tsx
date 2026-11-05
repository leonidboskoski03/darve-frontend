import { useContext, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Landing } from '@/features/landing/index';
import { CreatorSessionContext, useCreatorSession } from '@/features/session-status/index';
import { LoadingState } from '@/design-system/loading-state';
import { oauthReturnSearch } from '@/services/identity-navigation/index';

export function PublicHome() {
  useEffect(() => {
    document.title = 'Darve — The Engagement Engine for Your Viewers';
  }, []);
  return <Landing connectHref="/authorize" />;
}

function SignedInEntry() {
  const { snapshot } = useCreatorSession();
  const { search } = useLocation();
  const callback = oauthReturnSearch(search);
  if (snapshot.phase === 'loading') return <LoadingState label="Checking your session" />;
  if (snapshot.phase === 'authenticated')
    return <Navigate replace to={{ pathname: '/onboarding', search: callback }} />;
  if (callback) return <Navigate replace to={{ pathname: '/authorize', search: callback }} />;
  return <PublicHome />;
}

export function Component() {
  return useContext(CreatorSessionContext) ? <SignedInEntry /> : <PublicHome />;
}
