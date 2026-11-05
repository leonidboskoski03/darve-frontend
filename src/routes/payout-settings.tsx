import { useContext, useEffect } from 'react';
import { CreatorSessionContext, useCreatorSession } from '@/features/session-status/index';
import { CreatorAccess } from '@/features/creator-access/index';
import { PayoutSettings } from '@/features/payout-settings/index';

function Configured() {
  const { controller, snapshot } = useCreatorSession();
  if (snapshot.phase !== 'authenticated' || snapshot.user?.termsStatus.status !== 'accepted')
    return (
      <CreatorAccess
        runtime={{ origin: controller.origin!, session: controller, snapshot }}
        notice={null}
        mode="connect"
      />
    );
  return <PayoutSettings key={snapshot.scope.id} session={controller} />;
}

export function Component() {
  const session = useContext(CreatorSessionContext);
  useEffect(() => {
    document.title = 'Payout settings — Darve';
  }, []);
  return session?.origin ? (
    <Configured />
  ) : (
    <CreatorAccess runtime={null} notice={null} mode="connect" />
  );
}
