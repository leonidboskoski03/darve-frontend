import { useContext, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CreatorSessionContext, useCreatorSession } from '@/features/session-status/index';
import { CreatorAccess } from '@/features/creator-access/index';
import { Templates } from '@/features/templates/index';
function Configured() {
  const { controller, snapshot } = useCreatorSession();
  const [query] = useSearchParams();
  const ownedOnly = query.get('view') === 'owned';
  if (snapshot.phase !== 'authenticated')
    return (
      <CreatorAccess
        runtime={{ origin: controller.origin!, session: controller, snapshot }}
        notice={null}
        mode="connect"
      />
    );
  return (
    <Templates
      key={snapshot.scope.id}
      session={controller}
      ownedOnly={ownedOnly}
      navigation={
        <nav className="templates-filters" aria-label="Template view">
          <Link to="/templates" aria-current={!ownedOnly ? 'page' : undefined}>
            All templates
          </Link>
          <Link to="/templates?view=owned" aria-current={ownedOnly ? 'page' : undefined}>
            Owned templates
          </Link>
        </nav>
      }
      coinHistory={<Link to="/coins">View missions and coin history</Link>}
    />
  );
}
export function Component() {
  const session = useContext(CreatorSessionContext);
  useEffect(() => {
    document.title = 'Templates — Darve';
  }, []);
  return session?.origin ? (
    <Configured />
  ) : (
    <CreatorAccess runtime={null} notice={null} mode="connect" />
  );
}
