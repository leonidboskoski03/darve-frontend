import { useContext, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CreatorSessionContext, useCreatorSession } from '@/features/session-status/index';
import { CreatorAccess } from '@/features/creator-access/index';
import { Support } from '@/features/support/index';

function Configured() {
  const { controller, snapshot } = useCreatorSession();
  const { ticketId } = useParams();
  const navigate = useNavigate();
  // Support remains reachable before accepting terms and while business admission is denied.
  if (snapshot.phase !== 'authenticated')
    return (
      <CreatorAccess
        runtime={{ origin: controller.origin!, session: controller, snapshot }}
        notice={null}
        mode="connect"
      />
    );
  return (
    <Support
      key={snapshot.scope.id}
      session={controller}
      id={ticketId}
      onOpen={(id) => {
        void navigate('/support/' + id);
      }}
      onList={() => {
        void navigate('/support');
      }}
      onContext={(context) => {
        if (context.kind === 'challenge') void navigate('/challenges/' + context.id);
        if (context.kind === 'round') void navigate('/collection/' + context.id);
      }}
    />
  );
}
export function Component() {
  const session = useContext(CreatorSessionContext);
  useEffect(() => {
    document.title = 'Support — Darve';
  }, []);
  return session?.origin ? (
    <Configured />
  ) : (
    <CreatorAccess runtime={null} notice={null} mode="connect" />
  );
}
