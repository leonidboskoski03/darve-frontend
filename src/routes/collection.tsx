import { useContext, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CreatorSessionContext, useCreatorSession } from '@/features/session-status/index';
import { CreatorAccess } from '@/features/creator-access/index';
import { Collection } from '@/features/collection/index';

function Configured() {
  const { controller, snapshot } = useCreatorSession();
  const { roundId } = useParams();
  const navigate = useNavigate();
  if (snapshot.phase !== 'authenticated' || snapshot.user?.termsStatus.status !== 'accepted')
    return (
      <CreatorAccess
        runtime={{ origin: controller.origin!, session: controller, snapshot }}
        notice={null}
        mode="connect"
      />
    );
  return (
    <Collection
      session={controller}
      snapshot={snapshot}
      roundId={roundId}
      onStarted={(id) => {
        void navigate('/collection/' + id);
      }}
    />
  );
}
export function Component() {
  const session = useContext(CreatorSessionContext);
  useEffect(() => {
    document.title = 'Collection — Darve';
  }, []);
  return session?.origin ? (
    <Configured />
  ) : (
    <CreatorAccess runtime={null} notice={null} mode="connect" />
  );
}
