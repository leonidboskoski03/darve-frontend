import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Square, RefreshCw, Users, MessageSquare, Radio } from 'lucide-react';
import { Button } from '@/design-system/button';
import { Dialog } from '@/design-system/dialog';
import { LoadingState } from '@/design-system/loading-state';
import {
  type CollectionClient,
  type RoundRead,
  type RoundDto,
  remainingCollectionSeconds,
  roundIsFresh,
  retainNewerRound,
  isCollectionVisible,
} from '@/services/collection/index';
import type { CreatorSnapshot } from '@/services/creator-session/index';
import { CollectionProblem } from './error';
import { useDisplayClock } from './use-display-clock';

const title = (round: RoundDto) =>
  round.closeReason === 'PREPARATION_CANCELLED'
    ? 'Collection cancelled'
    : {
        preparing: 'Preparing your collection',
        collecting: 'Collecting viewer ideas',
        closed: 'Collection ended',
        failed: 'Collection could not start',
      }[round.state];
export function CollectionRound({
  client,
  snapshot,
  roundId,
}: {
  client: CollectionClient;
  snapshot: CreatorSnapshot;
  roundId: string;
}) {
  const key = snapshot.scope.key(['collection-round', roundId]);
  const cache = snapshot.scope.queryClient;
  const [confirmation, setConfirmation] = useState<{
    version: number;
    kind: 'stop' | 'cancel';
  } | null>(null);
  const stop = useMutation({
    mutationFn: async (round: RoundDto) => {
      await cache.cancelQueries({ queryKey: key, exact: true });
      return client.stop(round);
    },
    retry: false,
    onSuccess: (read) => {
      cache.setQueryData(key, read);
      setConfirmation(null);
    },
    onError: () => {
      void cache.invalidateQueries({ queryKey: key, exact: true });
    },
  });
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const next = await client.round(roundId, signal);
      return retainNewerRound(cache.getQueryData<RoundRead>(key), next);
    },
    retry: false,
    refetchInterval: (state) =>
      isCollectionVisible() &&
      !stop.isPending &&
      !state.state.error &&
      state.state.data &&
      ['preparing', 'collecting'].includes(state.state.data.round.state)
        ? 1000
        : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
  const read = query.data;
  const round = read?.round;
  const { now, visible } = useDisplayClock(
    round?.state === 'preparing' || round?.state === 'collecting',
  );
  const displayNow = read ? Math.max(now, read.receivedAt) : now;
  const fresh = read && visible && roundIsFresh(read, displayNow) && !query.isError;
  const seconds = read && fresh ? remainingCollectionSeconds(read, displayNow) : null;
  const canStop =
    round &&
    fresh &&
    round.allowedActions.some((action) => action === 'stop' || action === 'cancel') &&
    !stop.isPending;
  const changed = confirmation && round && confirmation.version !== round.version;
  if (query.isPending) return <LoadingState label="Loading collection state" />;
  if (!round)
    return (
      <section className="collection-panel">
        <h1>Collection unavailable</h1>
        <CollectionProblem error={query.error} />
        <Button
          tone="secondary"
          busy={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          Check collection
        </Button>
        <a href="/collection">Back to collection setup</a>
      </section>
    );
  return (
    <>
      <div className="collection-page-heading">
        <span className="collection-eyebrow">{round.provider} · Collection</span>
        <h1>{title(round)}</h1>
        <p>
          {round.state === 'preparing'
            ? 'We are waiting for the server to confirm the reader, stream and capacity. Collection has not started.'
            : round.state === 'collecting'
              ? 'Viewers can send #darve followed by their challenge. The server owns the collection window.'
              : 'The server keeps this round. Starting another collection does not remove it.'}
        </p>
      </div>
      <div className="collection-round-grid">
        <section className="collection-panel collection-live" aria-labelledby="round-status-title">
          <h2 id="round-status-title" className="sr-only">
            Collection status
          </h2>
          <div className={`collection-timer collection-timer--${round.state}`}>
            <Radio size={24} aria-hidden="true" />
            <span className="collection-timer__value" aria-label="Remaining collection time">
              {round.state === 'preparing'
                ? 'Waiting'
                : round.state === 'collecting'
                  ? seconds === null
                    ? '—'
                    : `${seconds}s`
                  : round.closeReason === 'PREPARATION_CANCELLED'
                    ? 'Cancelled'
                    : round.state === 'closed'
                      ? 'Ended'
                      : 'Not started'}
            </span>
            <span>
              {round.state === 'collecting'
                ? fresh
                  ? seconds === 0
                    ? 'Confirming server status'
                    : 'Remaining'
                  : 'Time unavailable'
                : round.state === 'preparing'
                  ? 'Not collecting yet'
                  : 'Server-confirmed state'}
            </span>
          </div>
          {!fresh && ['preparing', 'collecting'].includes(round.state) ? (
            <p role="status" className="collection-warning">
              Current status is unavailable. Your collection can continue on the server. Check its
              status before another action.
            </p>
          ) : null}
          <CollectionProblem error={query.error} />
          <CollectionProblem error={confirmation ? null : stop.error} />
          <div className="collection-round-actions">
            <Button
              tone="secondary"
              busy={query.isFetching}
              disabled={stop.isPending}
              onClick={() => {
                void query.refetch();
              }}
            >
              <RefreshCw size={16} aria-hidden="true" />
              Check status
            </Button>
            {round.allowedActions.some((action) => action === 'stop' || action === 'cancel') ? (
              <Button
                tone="danger"
                disabled={!canStop}
                onClick={() => {
                  stop.reset();
                  setConfirmation({
                    version: round.version,
                    kind: round.state === 'preparing' ? 'cancel' : 'stop',
                  });
                }}
              >
                <Square size={16} aria-hidden="true" />
                {round.state === 'preparing' ? 'Cancel preparation' : 'Stop collection'}
              </Button>
            ) : null}
          </div>
          {round.state === 'closed' ? (
            <a href={`/collection/${encodeURIComponent(round.id)}/suggestions`}>
              Review viewer ideas
            </a>
          ) : null}
          {round.state === 'closed' ? (
            <p className="collection-muted">
              {round.analysis?.state === 'empty'
                ? 'No eligible ideas were collected.'
                : round.analysis?.state === 'restricted'
                  ? 'The result is restricted.'
                  : round.analysis?.state === 'failed'
                    ? 'Analysis could not finish.'
                    : round.analysis?.state === 'succeeded'
                      ? 'Your ideas are ready for review.'
                      : 'Your ideas are being processed. Open review for updates.'}
            </p>
          ) : null}
          {round.state === 'failed' ? (
            <p className="collection-warning">
              {round.closeReason === 'PREPARATION_CANCELLED'
                ? 'Preparation was cancelled before any collection window started.'
                : round.closeReason === 'CAPACITY_BUSY'
                  ? 'Processing capacity was unavailable. Try a new collection later.'
                  : round.closeReason === 'TERMS_REQUIRED'
                    ? 'Review your current account terms before trying again.'
                    : round.closeReason === 'REAUTHORIZATION_REQUIRED' ||
                        round.closeReason === 'PERMISSION_REQUIRED'
                      ? 'Review your connection permissions before trying again.'
                      : 'Preparation ended before collection could start. Check stream readiness before trying again.'}
            </p>
          ) : null}
        </section>
        <aside className="collection-panel collection-facts">
          <h2>Round details</h2>
          <dl>
            <dt>Duration</dt>
            <dd>{round.collectionDurationSeconds} seconds</dd>
            <dt>Coverage</dt>
            <dd>
              {round.coverage.availability === 'available'
                ? 'No known capture gaps'
                : round.coverage.availability === 'partial'
                  ? 'Some capture gaps were recorded'
                  : 'Capture coverage is not confirmed'}
            </dd>
            <dt>DarveBot notice</dt>
            <dd>{round.announcement.state.replaceAll('_', ' ')}</dd>
            <dt>Chat pin replacement</dt>
            <dd>
              {round.announcementPinMode === 'replace_existing'
                ? 'Allowed for this round'
                : 'Not requested'}
            </dd>
            {round.streamContext?.title.value ? (
              <>
                <dt>Stream title at start</dt>
                <dd>{round.streamContext.title.value}</dd>
              </>
            ) : null}
            {round.streamerContext ? (
              <>
                <dt>Your clarification</dt>
                <dd>{round.streamerContext.value}</dd>
              </>
            ) : null}
          </dl>
          <p className="collection-muted">
            Counts show the last confirmed server read. Coverage does not guarantee every chat
            message was captured.
          </p>
          <div className="collection-counts">
            <div>
              <MessageSquare size={19} aria-hidden="true" />
              <strong>{round.counts.admittedSubmissions}</strong>
              <span>Admitted messages</span>
            </div>
            <div>
              <Users size={19} aria-hidden="true" />
              <strong>{round.counts.distinctSubmitters}</strong>
              <span>Distinct viewers</span>
            </div>
          </div>
        </aside>
      </div>
      <div className="collection-bottom">
        <a href="/collection">Back to collection setup</a>
        <span className="collection-muted">
          Keep this collection link to return after a reload.
        </span>
      </div>
      {confirmation ? (
        <Dialog
          open
          title={confirmation.kind === 'cancel' ? 'Cancel preparation?' : 'Stop this collection?'}
          description={
            confirmation.kind === 'cancel'
              ? 'This cancels the waiting round. No collection window has started.'
              : 'This asks the server to close collection and keep its admitted ideas.'
          }
          onDismiss={() => {
            if (!stop.isPending) setConfirmation(null);
          }}
        >
          <CollectionProblem error={stop.error} />
          {changed ? (
            <p role="alert">
              The collection changed. Close this dialog and review its current status before
              confirming again.
            </p>
          ) : !fresh ? (
            <p role="status">Check current status before confirming this action.</p>
          ) : null}
          <div className="collection-dialog-actions">
            <Button
              tone="secondary"
              disabled={stop.isPending}
              onClick={() => setConfirmation(null)}
            >
              Back to status
            </Button>
            <Button
              tone="danger"
              busy={stop.isPending}
              disabled={!!changed || !fresh}
              onClick={() => stop.mutate(round)}
            >
              {confirmation.kind === 'cancel' ? 'Confirm cancellation' : 'Confirm stop'}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
