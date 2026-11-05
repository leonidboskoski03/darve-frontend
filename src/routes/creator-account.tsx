import { useContext, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { controlStyles } from '@/design-system/control-styles';
import { AccountSettings, CreatorAccess } from '@/features/creator-access/index';
import { CreatorSessionContext, useCreatorSession } from '@/features/session-status/index';

function Configured({ origin }: { origin: string }) {
  const { controller, snapshot } = useCreatorSession();
  const user = snapshot.user;
  if (snapshot.phase !== 'authenticated' || user?.termsStatus.status !== 'accepted')
    return (
      <CreatorAccess
        runtime={{ origin, session: controller, snapshot }}
        notice={null}
        mode="connect"
      />
    );
  return (
    <AccountSettings
      displayName={user.displayName}
      terms={user.termsStatus}
      termsLink={
        <Link className={controlStyles('secondary')} to="/terms">
          Review account terms
        </Link>
      }
      connectionsLink={
        <Link className={controlStyles('secondary')} to="/integrations">
          Manage streaming connections
        </Link>
      }
      payoutsLink={
        <Link className={controlStyles('secondary')} to="/account/payments">
          Open payout settings
        </Link>
      }
    />
  );
}

export function Component() {
  const session = useContext(CreatorSessionContext);
  useEffect(() => {
    document.title = 'Account settings — Darve';
  }, []);
  return session?.origin ? (
    <Configured origin={session.origin} />
  ) : (
    <CreatorAccess runtime={null} notice={null} mode="connect" />
  );
}
