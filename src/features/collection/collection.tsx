import { useMemo } from 'react';
import { createCollectionClient } from '@/services/collection/index';
import type { CreatorSession, CreatorSnapshot } from '@/services/creator-session/index';
import { CollectionSetup } from './setup';
import { CollectionRound } from './round';
import './collection.css';
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
    <CollectionSetup client={client} snapshot={snapshot} onStarted={onStarted} />
  );
}
