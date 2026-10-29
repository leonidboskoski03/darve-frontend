import { useMemo } from 'react';
import { createCreatorAccessClient } from '@/services/creator-access/index';
import type { CreatorSession, CreatorSnapshot } from '@/services/creator-session/index';
import { Starfield } from '@/design-system/starfield';
import { Button } from '@/design-system/button';
import { ContentState } from '@/design-system/content-state';
import { LoadingState } from '@/design-system/loading-state';
import { SignIn } from './sign-in';
import { Terms } from './terms';
import { Connections } from './connections';
import './creator-access.css';

type Runtime = { origin: string; session: CreatorSession; snapshot: CreatorSnapshot };
function ConfiguredAccess({ runtime, mode }: { runtime: Runtime; mode: 'connect' | 'terms' }) {
  const { origin, session, snapshot } = runtime;
  const client = useMemo(() => createCreatorAccessClient({ origin, session }), [origin, session]);
  if (['loading', 'signing_out'].includes(snapshot.phase))
    return (
      <div className="creator-card creator-card--narrow">
        <LoadingState
          label={snapshot.phase === 'loading' ? 'Checking your session' : 'Signing out'}
        />
      </div>
    );
  if (snapshot.phase === 'unavailable' || snapshot.phase === 'logout_unconfirmed')
    return (
      <div className="creator-card creator-card--narrow">
        <ContentState
          kind="unavailable"
          title={
            snapshot.phase === 'logout_unconfirmed'
              ? 'Sign-out could not be confirmed'
              : 'Your session could not be checked'
          }
          action={
            <Button
              onClick={() => {
                if (snapshot.phase === 'logout_unconfirmed') void session.logout();
                else void session.inspect();
              }}
            >
              {snapshot.phase === 'logout_unconfirmed' ? 'Retry sign out' : 'Check session'}
            </Button>
          }
        >
          <p>
            Private account information is hidden until the server confirms the current session.
          </p>
        </ContentState>
      </div>
    );
  if (snapshot.phase !== 'authenticated')
    return (
      <>
        {snapshot.phase === 'expired' ? (
          <p className="creator-notice" role="status">
            Your session expired. Sign in again to continue.
          </p>
        ) : null}
        <SignIn client={client} />
      </>
    );
  if (mode === 'terms' || snapshot.user?.termsStatus.status !== 'accepted')
    return <Terms client={client} session={session} snapshot={snapshot} />;
  return <Connections client={client} snapshot={snapshot} />;
}
export function CreatorAccess({
  runtime,
  notice,
  mode,
}: {
  runtime: Runtime | null;
  notice: string | null;
  mode: 'connect' | 'terms';
}) {
  return (
    <div className="creator-access">
      <Starfield />
      {notice ? (
        <p className="creator-notice" role="status">
          {notice}
        </p>
      ) : null}
      {runtime ? (
        <ConfiguredAccess runtime={runtime} mode={mode} />
      ) : (
        <SignIn
          client={null}
          disabledReason="Account sign-in is unavailable because this site is not connected to its server yet."
        />
      )}
    </div>
  );
}
