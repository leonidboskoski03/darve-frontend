import { useContext, useEffect } from 'react';
import { CreatorSessionContext, useCreatorSession } from '@/features/session-status/index';
import { CreatorAccess } from '@/features/creator-access/index';
import { Coins } from '@/features/coins/index';
function Configured() {
  const { controller, snapshot } = useCreatorSession();
  if (snapshot.phase !== 'authenticated')
    return (
      <CreatorAccess
        runtime={{ origin: controller.origin!, session: controller, snapshot }}
        notice={null}
        mode="connect"
      />
    );
  return <Coins key={snapshot.scope.id} session={controller} snapshot={snapshot} />;
}
export function Component() {
  const session = useContext(CreatorSessionContext);
  useEffect(() => {
    document.title = 'Coins — Darve';
  }, []);
  return session?.origin ? (
    <Configured />
  ) : (
    <CreatorAccess runtime={null} notice={null} mode="connect" />
  );
}
