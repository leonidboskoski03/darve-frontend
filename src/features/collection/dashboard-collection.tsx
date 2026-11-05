import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActionLink } from '@/design-system/action-link';
import { Button } from '@/design-system/button';
import { Panel } from '@/design-system/panel';
import {
  createCollectionClient,
  retainNewerRound,
  type CollectionClient,
  type RoundRead,
} from '@/services/collection/index';
import type { CreatorSession, CreatorSnapshot } from '@/services/creator-session/index';
import { useCurrentCollection } from './current-query';

function CurrentRound({
  id,
  client,
  scope,
}: {
  id: string;
  client: CollectionClient;
  scope: CreatorSnapshot['scope'];
}) {
  const key = scope.key(['collection-round', id]);
  const round = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      retainNewerRound(
        scope.queryClient.getQueryData<RoundRead>(key),
        await client.round(id, signal),
      ),
    retry: false,
    networkMode: 'always',
    refetchOnMount: 'always',
  });
  if (round.isError)
    return <p>Current round status is unavailable. Check collection status again.</p>;
  if (round.isFetching || !round.data) return <p role="status">Checking the current round…</p>;
  const { round: value, serverTime } = round.data;
  const status = {
    preparing: 'Preparing',
    collecting: 'Collecting viewer ideas',
    closed: 'Collection ended',
    failed: 'Collection did not start',
  }[value.state];
  const ended = value.state === 'closed';
  return (
    <>
      <p>
        <strong>{status}</strong> · {value.provider}
      </p>
      {value.state === 'preparing' ? (
        <p>The server is checking the stream, reader and capacity.</p>
      ) : null}
      <p>
        <small>
          Checked <time dateTime={serverTime}>{serverTime.slice(11, 19)} UTC</time>
        </small>
      </p>
      <ActionLink href={`/collection/${id}${ended ? '/suggestions' : ''}`}>
        {ended
          ? 'Review viewer ideas'
          : value.state === 'failed'
            ? 'View round status'
            : 'Resume collection'}
      </ActionLink>
    </>
  );
}

export function DashboardCollection({
  session,
  snapshot,
}: {
  session: CreatorSession;
  snapshot: CreatorSnapshot;
}) {
  const [client] = useState(() => createCollectionClient(session));
  const current = useCurrentCollection(client, snapshot.scope);
  return (
    <Panel title="Collection">
      <div aria-live="polite">
        {current.isError ? (
          <p>Active collection could not be checked. Check again before starting another round.</p>
        ) : current.isFetching || current.isPending ? (
          <p>Checking for an active collection…</p>
        ) : current.data ? (
          <CurrentRound id={current.data} client={client} scope={snapshot.scope} />
        ) : (
          <>
            <p>No active collection. Choose a stream to start collecting ideas.</p>
            <ActionLink href="/collection">Open collection setup</ActionLink>
          </>
        )}
      </div>
      <Button
        tone="quiet"
        busy={current.isFetching}
        onClick={() => {
          void current.refetch();
        }}
      >
        Check collection status
      </Button>
    </Panel>
  );
}
