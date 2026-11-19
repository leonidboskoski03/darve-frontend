import { useContext, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Landing } from '@/features/landing/index';
import { CreatorSessionContext, useCreatorSession } from '@/features/session-status/index';
import { LoadingState } from '@/design-system/loading-state';
import {
  oauthReturnSearch,
  rememberCreatorReturn,
  storedCreatorReturn,
} from '@/services/identity-navigation/index';

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
  const [returnTo] = useState(() => (callback ? storedCreatorReturn() : null));
  const willResume =
    snapshot.phase === 'authenticated' &&
    new URLSearchParams(callback).get('oauth_result') === 'success' &&
    returnTo !== null;
  useEffect(() => {
    if (willResume) rememberCreatorReturn(null);
  }, [willResume]);
  if (willResume) return <Navigate replace to={returnTo} />;
  if (snapshot.phase === 'loading') return <LoadingState label="Checking your session" />;
  if (snapshot.phase === 'authenticated')
    return <Navigate replace to={{ pathname: '/onboarding', search: callback }} />;
  if (callback) {
    const query = new URLSearchParams(callback);
    if (returnTo) query.set('returnTo', returnTo);
    return <Navigate replace to={{ pathname: '/authorize', search: '?' + query.toString() }} />;
  }
  return <PublicHome />;
}

export function Component() {
  return useContext(CreatorSessionContext) ? <SignedInEntry /> : <PublicHome />;
}
