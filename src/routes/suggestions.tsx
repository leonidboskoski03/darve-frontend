import { useContext, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CreatorSessionContext, useCreatorSession } from '@/features/session-status/index';
import { CreatorAccess } from '@/features/creator-access/index';
import { SuggestionReview } from '@/features/suggestion-review/index';
function Configured() {
  const { controller, snapshot } = useCreatorSession();
  const { roundId } = useParams();
  const [search, setSearch] = useSearchParams();
  const value = search.get('filter');
  const filter =
    value === 'recommended' || value === 'pinned' || value === 'dismissed' ? value : 'all';
  if (snapshot.phase !== 'authenticated' || snapshot.user?.termsStatus.status !== 'accepted')
    return (
      <CreatorAccess
        runtime={{ origin: controller.origin!, session: controller, snapshot }}
        notice={null}
        mode="connect"
      />
    );
  return (
    <SuggestionReview
      key={roundId}
      session={controller}
      snapshot={snapshot}
      roundId={roundId ?? ''}
      filter={filter}
      onFilter={(next) => {
        void setSearch(next === 'all' ? {} : { filter: next });
      }}
    />
  );
}
export function Component() {
  const session = useContext(CreatorSessionContext);
  useEffect(() => {
    document.title = 'Review viewer ideas — Darve';
  }, []);
  return session?.origin ? (
    <Configured />
  ) : (
    <CreatorAccess runtime={null} notice={null} mode="connect" />
  );
}
