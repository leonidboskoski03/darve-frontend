import { useState } from 'react';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { Play, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/design-system/button';
import { LoadingState } from '@/design-system/loading-state';
import { ContentState } from '@/design-system/content-state';
import {
  type CollectionClient,
  type StartAttempt,
  type Discovery,
  uncertainCommand,
} from '@/services/collection/index';
import type { Connection } from '@/services/creator-access/index';
import type { CreatorSnapshot } from '@/services/creator-session/index';
import { CollectionProblem } from './error';
import { useDisplayClock } from './use-display-clock';

const freshDiscovery = (page: Discovery, now: number) =>
  page.discovery.complete &&
  ['live', 'offline', 'ambiguous'].includes(page.discovery.state) &&
  page.discovery.freshUntil !== null &&
  Math.max(0, now - page.receivedAt) <
    Date.parse(page.discovery.freshUntil) - Date.parse(page.serverTime);

export function StartSettings({
  client,
  snapshot,
  connection,
  onStarted,
  onLocked,
}: {
  client: CollectionClient;
  snapshot: CreatorSnapshot;
  connection: Connection;
  onStarted: (roundId: string) => void;
  onLocked: (locked: boolean) => void;
}) {
  const { now } = useDisplayClock();
  const [broadcastId, setBroadcastId] = useState('');
  const [duration, setDuration] = useState(30);
  const [context, setContext] = useState('');
  const [pin, setPin] = useState(false);
  const [attempt, setAttempt] = useState<StartAttempt | null>(null);
  const [inputError, setInputError] = useState<unknown>(null);
  const streams = useInfiniteQuery({
    queryKey: snapshot.scope.key(['collection-streams', connection.id, connection.version]),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => client.broadcasts(connection.id, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const start = useMutation({
    mutationFn: (value: StartAttempt) => client.start(value),
    onError: (error) => onLocked(uncertainCommand(error)),
    retry: false,
    onSuccess: (read) => {
      snapshot.scope.queryClient.setQueryData(
        snapshot.scope.key(['collection-round', read.round.id]),
        read,
      );
      onStarted(read.round.id);
    },
  });
  const uncertain = start.isError && uncertainCommand(start.error);
  const busy = start.isPending || start.isSuccess;
  const locked = busy || uncertain;
  const pages = streams.data?.pages ?? [];
  const broadcasts = new Map(pages.flatMap((page) => page.items).map((item) => [item.id, item]));
  const live = [...broadcasts.values()].filter((item) => item.status === 'live');
  const selected =
    live.find((item) => item.id === broadcastId) ?? (live.length === 1 ? live[0] : undefined);
  const fresh = pages.length > 0 && pages.every((page) => freshDiscovery(page, now));
  const permitted =
    !connection.reauthorizationRequired &&
    !['revoked', 'disconnected', 'unconfigured', 'missing', 'reauthorization_required'].includes(
      connection.grantState,
    );
  const canStart =
    selected &&
    fresh &&
    permitted &&
    !streams.hasNextPage &&
    !streams.isFetching &&
    !streams.isError &&
    duration >= 1 &&
    duration <= 60;
  return (
    <section className="collection-panel collection-settings" aria-labelledby="settings-title">
      <div className="collection-panel__heading">
        <div>
          <span className="collection-eyebrow">02 · Collection settings</span>
          <h2 id="settings-title">Choose your live stream</h2>
        </div>
        <Button
          tone="quiet"
          busy={streams.isFetching}
          disabled={locked}
          onClick={() => {
            void streams.refetch();
          }}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Refresh streams
        </Button>
      </div>
      {streams.isPending ? (
        <LoadingState label="Checking owned live streams" />
      ) : streams.isError ? (
        <CollectionProblem error={streams.error} />
      ) : (
        <>
          {live.length === 0 ? (
            <ContentState
              kind="unavailable"
              title={
                pages.some((page) => page.discovery.state === 'offline')
                  ? 'Your stream is offline'
                  : 'No confirmed live stream is available'
              }
            >
              <p>
                Go live on{' '}
                {connection.provider === 'youtube'
                  ? 'YouTube'
                  : connection.provider === 'kick'
                    ? 'Kick'
                    : 'Twitch'}
                , then refresh streams. Unknown or unavailable status is not proof that a stream
                ended.
              </p>
            </ContentState>
          ) : (
            <label className="ds-field">
              <span className="ds-field__label">Live broadcast</span>
              <select
                className="ds-input"
                value={selected?.id ?? ''}
                disabled={locked}
                onChange={(event) => setBroadcastId(event.target.value)}
              >
                <option value="" disabled>
                  Choose a live broadcast
                </option>
                {live.map((stream) => (
                  <option key={stream.id} value={stream.id}>
                    Live · {stream.providerBroadcastId ?? stream.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!fresh && live.length > 0 ? (
            <p className="collection-warning" role="status">
              Stream information is incomplete or out of date. Refresh before starting.
            </p>
          ) : null}
          {streams.hasNextPage ? (
            <Button
              tone="secondary"
              busy={streams.isFetchingNextPage}
              disabled={locked}
              onClick={() => {
                void streams.fetchNextPage();
              }}
            >
              Load more streams
            </Button>
          ) : null}
          {!permitted ? (
            <p className="collection-warning">
              Review this account’s permissions in <a href="/integrations">Connections</a> before
              collecting.
            </p>
          ) : null}
          {selected ? (
            <p className="collection-muted">
              Chat reader:{' '}
              {selected.chatReadiness.state === 'ready'
                ? 'ready'
                : selected.chatReadiness.state === 'preparing'
                  ? 'preparing'
                  : 'not confirmed'}
              . DarveBot notices:{' '}
              {selected.chatReadiness.announcement.state === 'ready'
                ? 'ready'
                : 'unavailable or not confirmed'}
              .
            </p>
          ) : null}
        </>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canStart || locked) return;
          setInputError(null);
          try {
            const next = client.prepareStart({
              connectionId: connection.id,
              broadcastId: selected.id,
              collectionDurationSeconds: duration,
              announcementPinMode:
                connection.provider === 'twitch' && pin ? 'replace_existing' : 'off',
              ...(context.trim() ? { streamerContext: context } : {}),
            });
            setAttempt(next);
            onLocked(true);
            start.mutate(next);
          } catch (error) {
            setInputError(error);
          }
        }}
      >
        <fieldset disabled={locked} className="collection-fieldset">
          <label htmlFor="collection-duration" className="collection-duration-label">
            Collection duration <output htmlFor="collection-duration">{duration} seconds</output>
          </label>
          <input
            id="collection-duration"
            type="range"
            min="0"
            max="60"
            step="1"
            value={duration}
            aria-describedby="duration-hint"
            onChange={(event) => setDuration(Number(event.target.value))}
          />
          <div className="collection-range-labels">
            <span>0s</span>
            <span>30s</span>
            <span>60s</span>
          </div>
          <p id="duration-hint" className="collection-muted">
            Choose 1–60 seconds. At zero, Start is unavailable.
          </p>
          <label className="ds-field">
            <span className="ds-field__label">
              What are you doing on stream? <span className="collection-muted">Optional</span>
            </span>
            <textarea
              className="ds-input"
              rows={3}
              maxLength={1000}
              value={context}
              onChange={(event) => setContext(event.target.value)}
              placeholder="Give context that helps interpret viewer ideas."
            />
          </label>
          {connection.provider === 'twitch' ? (
            <label className="collection-checkbox">
              <input
                type="checkbox"
                checked={pin}
                onChange={(event) => setPin(event.target.checked)}
              />
              <span>
                Allow Darve to replace an existing pinned chat message for this collection.
              </span>
            </label>
          ) : (
            <p className="collection-muted">
              Automatic chat pinning is unavailable on this platform.
            </p>
          )}
        </fieldset>
        <p className="collection-muted">
          <ShieldCheck size={16} aria-hidden="true" /> The server checks receiving setup,
          permissions and reader capacity when you start. Unavailable DarveBot notices do not prove
          the collection failed.
        </p>
        <CollectionProblem error={inputError ?? start.error} />
        {uncertain && attempt ? (
          <div className="collection-uncertain">
            <p>
              The result is unconfirmed. Your settings are held for a deliberate retry of the same
              request. Do not start a second collection from another tab.
            </p>
            <Button tone="secondary" busy={start.isPending} onClick={() => start.mutate(attempt)}>
              Retry the same Start request
            </Button>
          </div>
        ) : null}
        <Button
          type="submit"
          busy={start.isPending}
          disabled={!canStart || locked}
          className="collection-start"
        >
          <Play size={18} aria-hidden="true" />
          Start collection
        </Button>
      </form>
    </section>
  );
}
