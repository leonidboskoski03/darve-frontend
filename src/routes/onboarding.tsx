import { useContext, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { controlStyles } from '@/design-system/control-styles';
import { CreatorAccess, OnboardingGuide } from '@/features/creator-access/index';
import { ReceivingStatusSummary } from '@/features/payout-settings/index';
import { CreatorSessionContext, useCreatorSession } from '@/features/session-status/index';
import { oauthReturnNotice } from '@/services/identity-navigation/index';

function Configured({ origin }: { origin: string }) {
  const { controller, snapshot } = useCreatorSession();
  const { search } = useLocation();
  const user = snapshot.user;
  const accepted = user?.termsStatus.status === 'accepted';
  if (snapshot.phase !== 'authenticated' || !user)
    return (
      <CreatorAccess
        runtime={{ origin, session: controller, snapshot }}
        notice={
          ['signed_out', 'expired'].includes(snapshot.phase)
            ? oauthReturnNotice(search, false)
            : null
        }
        mode="connect"
      />
    );
  return (
    <OnboardingGuide
      session={controller}
      scope={snapshot.scope}
      terms={user.termsStatus}
      notice={oauthReturnNotice(search, true)}
      termsLink={
        <Link className={controlStyles(accepted ? 'secondary' : 'primary')} to="/terms">
          Review account terms
        </Link>
      }
      connectionsLink={
        <Link className={controlStyles('secondary')} to="/integrations">
          Manage streaming connections
        </Link>
      }
      receiving={<ReceivingStatusSummary session={controller} />}
      payoutsLink={
        <Link className={controlStyles('secondary')} to="/account/payments">
          Open payout settings
        </Link>
      }
      obsLink={
        <Link className={controlStyles('secondary')} to="/obs">
          Open OBS display setup
        </Link>
      }
      dashboardLink={
        <Link className={controlStyles('primary')} to="/dashboard">
          Continue to dashboard
        </Link>
      }
    />
  );
}

export function Component() {
  const creator = useContext(CreatorSessionContext);
  useEffect(() => {
    document.title = 'Creator setup — Darve';
  }, []);
  return creator?.origin ? (
    <Configured origin={creator.origin} />
  ) : (
    <CreatorAccess runtime={null} notice={null} mode="connect" />
  );
}
