import { useCreatorSession } from './session-context';
import './session-status.css';
import { Button } from '@/design-system/button';

/** Minimal connection status for the transport foundation; actual onboarding remains F03. */
export function SessionStatus() {
  const { controller, snapshot } = useCreatorSession();
  if (snapshot.phase === 'unconfigured') return null;
  return (
    <div className="session-status">
      <p role="status">
        {snapshot.phase === 'authenticated'
          ? `Signed in${snapshot.user?.displayName ? ` as ${snapshot.user.displayName}` : ''}`
          : {
              loading: 'Checking your session…',
              signed_out: 'Signed out',
              expired: 'Your session expired.',
              unavailable: 'Session unavailable. No action has been confirmed.',
              signing_out: 'Signing out…',
              logout_unconfirmed: 'Sign-out could not be confirmed. Private content is hidden.',
            }[snapshot.phase]}
      </p>
      {snapshot.phase === 'authenticated' ? (
        <Button
          tone="secondary"
          onClick={() => {
            void controller.logout();
          }}
        >
          Sign out
        </Button>
      ) : null}
      {['unavailable', 'expired'].includes(snapshot.phase) ? (
        <Button
          tone="secondary"
          onClick={() => {
            void controller.inspect();
          }}
        >
          Check session
        </Button>
      ) : null}
      {snapshot.phase === 'logout_unconfirmed' ? (
        <Button
          tone="secondary"
          onClick={() => {
            void controller.logout();
          }}
        >
          Retry sign out
        </Button>
      ) : null}
    </div>
  );
}
