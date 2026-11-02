import { useContext, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CreatorSessionContext, useCreatorSession } from '@/features/session-status/index';
import { CreatorAccess } from '@/features/creator-access/index';
import { OverlaySettings } from '@/features/overlay-settings/index';
import { OverlayParamsSchema } from '@/services/contracts/index';
function Configured() {
  const { controller, snapshot } = useCreatorSession(),
    [search, setSearch] = useSearchParams();
  if (snapshot.phase !== 'authenticated' || snapshot.user?.termsStatus.status !== 'accepted')
    return (
      <CreatorAccess
        runtime={{ origin: controller.origin!, session: controller, snapshot }}
        notice={null}
        mode="connect"
      />
    );
  const displayId = search.get('displayId');
  return (
    <OverlaySettings
      key={snapshot.scope.id}
      session={controller}
      displayId={
        OverlayParamsSchema.safeParse({ id: displayId }).success ? displayId!.toLowerCase() : null
      }
      onDisplay={(id) => void setSearch({ displayId: id })}
    />
  );
}
export function Component() {
  const session = useContext(CreatorSessionContext);
  useEffect(() => {
    document.title = 'OBS display — Darve';
  }, []);
  return session?.origin ? (
    <Configured />
  ) : (
    <CreatorAccess runtime={null} notice={null} mode="connect" />
  );
}
