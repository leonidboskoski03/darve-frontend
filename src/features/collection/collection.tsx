import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import { LoadingState } from '@/design-system/loading-state';
import { ContentState } from '@/design-system/content-state';
import type { CollectionClient } from '@/services/collection/index';
import { createCollectionClient } from '@/services/collection/index';
import type { CreatorSession, CreatorSnapshot } from '@/services/creator-session/index';
import { CollectionSetup } from './setup';
import { CollectionRound } from './round';
import './collection.css';

function CollectionEntry({
  client,
  snapshot,
  onStarted,
}: {
  client: CollectionClient;
  snapshot: CreatorSnapshot;
  onStarted: (id: string) => void;
}) {
  const current = useQuery({
    queryKey: snapshot.scope.key(['collection-current']),
    queryFn: ({ signal }) => client.currentRound(signal),
    retry: false,
    networkMode: 'always',
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const confirmed = current.isSuccess && !current.isFetching;
  const active = confirmed ? current.data : null;
  return (
    <>
      {current.isPending || current.isFetching ? (
        <LoadingState label="Checking for an active collection" />
      ) : null}
      {current.isError ? (
        <ContentState
          kind="unavailable"
          title="Active collection could not be checked"
          action={
            <Button
              tone="secondary"
              onClick={() => {
                void current.refetch();
              }}
            >
              Check active collection
            </Button>
          }
        >
          <p>Confirm whether a collection is already running before starting another one.</p>
        </ContentState>
      ) : null}
      {active ? (
        <section className="collection-panel">
          <span className="collection-eyebrow">Your stream</span>
          <h1>Continue your collection</h1>
          <p>Darve found a collection that is preparing or collecting for your account.</p>
          <Button onClick={() => onStarted(active)}>Resume collection</Button>
        </section>
      ) : null}
      {current.data === null ? (
        <CollectionSetup
          client={client}
          snapshot={snapshot}
          onStarted={onStarted}
          startAllowed={confirmed}
          onActiveConflict={() => {
            void current.refetch();
          }}
        />
      ) : null}
    </>
  );
}

export function Collection({
  session,
  snapshot,
  roundId,
  onStarted,
}: {
  session: CreatorSession;
  snapshot: CreatorSnapshot;
  roundId?: string | undefined;
  onStarted: (roundId: string) => void;
}) {
  const client = useMemo(() => createCollectionClient(session), [session]);
  return roundId ? (
    <CollectionRound key={roundId} client={client} snapshot={snapshot} roundId={roundId} />
  ) : (
    <CollectionEntry client={client} snapshot={snapshot} onStarted={onStarted} />
  );
}
