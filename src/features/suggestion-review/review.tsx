import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { Pin, X, RotateCcw } from 'lucide-react';
import { Button } from '@/design-system/button';
import type { CreatorSession, CreatorSnapshot } from '@/services/creator-session/index';
import {
  createSuggestionClient,
  reviewMessage,
  type Suggestion,
  type AcceptanceIdea,
  type UncertainIdea,
  type ReviewPage,
  type AcceptedChallenge,
} from '@/services/suggestions/index';
import { Credits } from './credits';
import { NeedsYourCall } from './needs-your-call';
import { AcceptDialog } from './accept-dialog';
import { ChallengeStatus } from './challenge';
import { AcceptanceStatus } from './acceptance-status';
import './review.css';
export type ReviewFilter = 'all' | 'recommended' | 'pinned' | 'dismissed';
const states: Record<string, string> = {
  pending: 'Ideas are waiting for analysis.',
  queued: 'Analysis is queued.',
  running: 'Ideas are being analyzed.',
  empty: 'No eligible ideas were collected.',
  failed: 'Analysis could not finish.',
  restricted: 'These source ideas are restricted.',
};
export function SuggestionReview({
  session,
  snapshot,
  roundId,
  filter,
  onFilter,
}: {
  session: CreatorSession;
  snapshot: CreatorSnapshot;
  roundId: string;
  filter: ReviewFilter;
  onFilter: (value: ReviewFilter) => void;
}) {
  const client = useMemo(() => createSuggestionClient(session), [session]);
  const key = snapshot.scope.key(['suggestions', roundId]);
  const cache = snapshot.scope.queryClient;
  const [listNotice, setListNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ item: AcceptanceIdea; page: ReviewPage } | null>(null);
  const [accepted, setAccepted] = useState<Pick<
    AcceptedChallenge,
    'id' | 'roundId' | 'suggestionId' | 'display' | 'chat'
  > | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const returnFocus = useRef<string | null>(null);
  useEffect(() => {
    if (selected || !returnFocus.current) return;
    const target = triggers.current.get(returnFocus.current);
    (target?.isConnected && !target.disabled ? target : heading.current)?.focus();
    returnFocus.current = null;
  }, [selected]);
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => client.page(roundId, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (state) =>
      state.state.error
        ? false
        : state.state.data?.pages.some((page) =>
              page.items.some((item) => item.reasonDetails?.pending),
            ) ||
            ['pending', 'queued', 'running'].includes(
              state.state.data?.pages[0]?.analysis?.state ?? '',
            )
          ? 2000
          : false,
    refetchIntervalInBackground: false,
  });
  const pages = query.data?.pages ?? [],
    first = pages[0];
  const mixed = pages.some(
    (page) =>
      page.resultVersion !== first?.resultVersion ||
      page.analysis?.analysisRunId !== first?.analysis?.analysisRunId ||
      page.analysis?.snapshotVersion !== first?.analysis?.snapshotVersion,
  );
  const rows = new Map<string, Suggestion>();
  for (const page of pages)
    for (const item of page.items)
      if ((rows.get(item.id)?.version ?? 0) <= item.version) rows.set(item.id, item);
  const items = [...rows.values()].sort((a, b) => a.rank - b.rank);
  const page = first ? { ...first, items } : null;
  const refresh = async () => {
    await cache.cancelQueries({ queryKey: key, exact: true });
    await cache.resetQueries({ queryKey: key, exact: true });
    await cache.invalidateQueries({
      queryKey: snapshot.scope.key(['uncertain-ideas', roundId]),
      exact: true,
    });
  };
  const disposition = useMutation({
    mutationFn: async ({
      item,
      pinned,
      dismissed,
    }: {
      item: Suggestion;
      pinned: boolean;
      dismissed: boolean;
    }) => {
      await cache.cancelQueries({ queryKey: key, exact: true });
      return client.disposition(item, pinned, dismissed);
    },
    retry: false,
    onSuccess: (data) =>
      setListNotice(
        data.pinned
          ? `Idea ${data.rank} pinned to the top of this list.`
          : data.dismissed
            ? `Idea ${data.rank} dismissed and moved to the bottom.`
            : `Idea ${data.rank} restored to its ranked place.`,
      ),
    onSettled: () => query.refetch(),
  });
  const available = !mixed && !query.isError && first?.analysis?.state === 'succeeded';
  const uncertain = useQuery({
    queryKey: snapshot.scope.key(['uncertain-ideas', roundId]),
    enabled: available,
    queryFn: ({ signal }) => client.uncertain(roundId, signal),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const privateItems =
    uncertain.data && uncertain.data.resultVersion === first?.resultVersion
      ? uncertain.data.items
      : [];
  const decision = useMutation({
    mutationFn: ({ item, action }: { item: UncertainIdea; action: 'allow' | 'skip' }) =>
      client.decide(item, action),
    retry: false,
    onSettled: () => uncertain.refetch(),
  });
  const canAct = available && !query.isFetching && !disposition.isPending && !decision.isPending;
  const roundAccepted =
    privateItems.some((item) => item.selectedChallengeId !== null) ||
    items.some((item) => item.selectedChallengeId !== null) ||
    accepted !== null;
  // Pinned ideas stay on top and dismissed ones sink, keeping rank order within
  // each group (stable sort), so the list visibly reflects each action.
  const weight = (item: Suggestion) => (item.pinned ? 0 : item.dismissed ? 2 : 1);
  const shown = items
    .filter(
      (item) =>
        filter === 'all' ||
        (filter === 'recommended'
          ? item.isRecommended
          : filter === 'pinned'
            ? item.pinned
            : item.dismissed),
    )
    .sort((a, b) => weight(a) - weight(b));
  const onAccepted = (result: AcceptedChallenge) => {
    setAccepted(result);
    setSelected(null);
    void query.refetch();
    void uncertain.refetch();
  };
  return (
    <>
      <div className="review-heading">
        <span className="review-eyebrow">Your stream · Your choice</span>
        <h1 ref={heading} tabIndex={-1}>
          Review viewer ideas
        </h1>
        <p>
          Choose one idea from this round. Other ideas and challenges from other rounds are kept.
        </p>
      </div>
      <div className="review-toolbar">
        <a href={`/collection/${encodeURIComponent(roundId)}`}>Back to collection status</a>
        <Button
          tone="secondary"
          busy={query.isFetching}
          disabled={disposition.isPending || selected !== null}
          onClick={() => {
            disposition.reset();
            void refresh();
          }}
        >
          Refresh results
        </Button>
      </div>
      {query.isPending ? (
        <p role="status">Loading review…</p>
      ) : query.isError ? (
        <p role="alert">{reviewMessage(query.error)}</p>
      ) : mixed ? (
        <p role="alert">
          The publication changed between pages. Refresh results before continuing.
        </p>
      ) : !available ? (
        <section className="review-panel">
          <h2>Collection results</h2>
          <p role="status">
            {states[first?.analysis?.state ?? ''] ??
              'No published review is available yet. Check collection status.'}
          </p>
          {first?.analysis?.progress && (
            <p>
              Stage: {first.analysis.progress.stage}. Prepared{' '}
              {first.analysis.progress.preparedSourceCount} of {first.analysis.progress.sourceCount}{' '}
              sources.
            </p>
          )}
        </section>
      ) : (
        <>
          <p className="review-muted">
            {first.totalSafeCount} safe ideas · {first.recommendedCount} recommended ·{' '}
            {first.uncertainCount} uncertain · {first.excludedCount} excluded. Uncertain ideas are
            listed privately below.
          </p>
          {first.analysis?.contextTruncated && (
            <p role="status">Some stream context was truncated during analysis.</p>
          )}
          {first.analysis?.equivalenceBoundReached && (
            <p role="status">
              Grouping reached its analysis bound; similar ideas may remain separate.
            </p>
          )}
          {roundAccepted && (
            <p role="status">
              This round already has an accepted challenge. Its other ideas remain available for
              review.
            </p>
          )}
          <nav className="review-filters" aria-label="Idea filters">
            {(['all', 'recommended', 'pinned', 'dismissed'] as const).map((value) => (
              <Button
                key={value}
                tone={value === filter ? 'primary' : 'secondary'}
                aria-pressed={value === filter}
                onClick={() => onFilter(value)}
              >
                {value === 'all' ? 'All safe' : value[0]!.toUpperCase() + value.slice(1)}
              </Button>
            ))}
          </nav>
          {listNotice && !disposition.error && <p role="status">{listNotice}</p>}
          {disposition.error && (
            <p role="alert">
              {reviewMessage(disposition.error)} Review the refreshed state before another action.
            </p>
          )}
          <section className="review-panel review-list" aria-label="Viewer ideas">
            {shown.length === 0 ? (
              <p>No matching ideas in the loaded pages.</p>
            ) : (
              shown.map((item) => (
                <article className="review-row" key={item.id} aria-label={`Idea ${item.rank}`}>
                  <div>
                    <span className="review-eyebrow">
                      Idea {item.rank}
                      {item.isRecommended ? ' · Recommended' : ''}
                      {item.pinned ? ' · Pinned' : ''}
                      {item.dismissed ? ' · Dismissed' : ''}
                    </span>
                    <h2>{item.text}</h2>
                    {item.reasonDetails ? (
                      <div
                        className={
                          item.reasonDetails.reasonSource === 'fallback'
                            ? 'review-summary review-muted'
                            : 'review-summary'
                        }
                      >
                        <p>{item.reasonDetails.interpretation}</p>
                        <p>
                          <span className="review-summary-label">
                            {item.reasonDetails.reasonSource === 'fallback'
                              ? 'Auto summary'
                              : 'Why this idea'}
                          </span>
                          {' · '}
                          {item.reasonDetails.reason}
                        </p>
                      </div>
                    ) : (
                      item.description && <p>{item.description}</p>
                    )}
                    {!item.reasonDetails && item.creativityExplanation && (
                      <p className="review-muted">Why recommended: {item.creativityExplanation}</p>
                    )}
                    <Credits item={item} />
                  </div>
                  <div className="review-actions">
                    {item.selectedChallengeId ? (
                      <Button
                        tone="secondary"
                        onClick={() =>
                          setAccepted((previous) =>
                            previous?.id === item.selectedChallengeId
                              ? previous
                              : { id: item.selectedChallengeId!, roundId, suggestionId: item.id },
                          )
                        }
                      >
                        View accepted challenge
                      </Button>
                    ) : (
                      <Button
                        ref={(node) => {
                          if (node) triggers.current.set(item.id, node);
                          else triggers.current.delete(item.id);
                        }}
                        disabled={!canAct || roundAccepted || item.dismissed}
                        onClick={() => {
                          if (page) setSelected({ item, page });
                        }}
                      >
                        Accept idea {item.rank}
                      </Button>
                    )}
                    <Button
                      tone="secondary"
                      aria-label={`${item.pinned ? 'Unpin' : 'Pin'} idea ${item.rank}`}
                      disabled={!canAct || selected !== null}
                      onClick={() =>
                        disposition.mutate({ item, pinned: !item.pinned, dismissed: false })
                      }
                    >
                      <Pin size={16} aria-hidden="true" />
                      {item.pinned ? 'Unpin' : 'Pin'}
                    </Button>
                    <Button
                      tone="quiet"
                      aria-label={`${item.dismissed ? 'Restore' : 'Dismiss'} idea ${item.rank}`}
                      disabled={!canAct || selected !== null}
                      onClick={() =>
                        disposition.mutate({ item, pinned: false, dismissed: !item.dismissed })
                      }
                    >
                      {item.dismissed ? (
                        <RotateCcw size={16} aria-hidden="true" />
                      ) : (
                        <X size={16} aria-hidden="true" />
                      )}
                      {item.dismissed ? 'Restore' : 'Dismiss'}
                    </Button>
                  </div>
                </article>
              ))
            )}
            <p className="review-muted">
              {items.length} of {first.totalSafeCount} safe ideas loaded. {shown.length} match this
              filter in these pages.
            </p>
            {query.hasNextPage && (
              <Button
                tone="secondary"
                busy={query.isFetchingNextPage}
                disabled={selected !== null || disposition.isPending}
                onClick={() => {
                  void query.fetchNextPage();
                }}
              >
                Load more ideas
              </Button>
            )}
          </section>
          {uncertain.isPending ? (
            <p role="status">Loading your private review…</p>
          ) : uncertain.error ? (
            <p role="alert">{reviewMessage(uncertain.error)}</p>
          ) : null}
          {decision.error ? (
            <p role="alert">
              {reviewMessage(decision.error)} Refresh the private review before another decision.
            </p>
          ) : null}
          <NeedsYourCall
            items={privateItems}
            busy={!canAct || decision.isPending || uncertain.isFetching || selected !== null}
            canSelect={!roundAccepted}
            onView={(item) =>
              setAccepted({ id: item.selectedChallengeId!, roundId, suggestionId: item.id })
            }
            onDecision={(item, action) => decision.mutate({ item, action })}
            onUse={(item) => {
              if (page) setSelected({ item, page });
            }}
          />
        </>
      )}
      {accepted && (
        <AcceptanceStatus key={accepted.id} accepted={accepted} client={client} session={session} />
      )}
      {accepted && available && (
        <ChallengeStatus
          key={accepted.id}
          client={client}
          snapshot={snapshot}
          id={accepted.id}
          roundId={roundId}
          suggestionId={accepted.suggestionId}
        />
      )}
      {selected && (
        <AcceptDialog
          client={client}
          page={selected.page}
          item={selected.item}
          current={
            available
              ? [...items, ...privateItems].find((item) => item.id === selected.item.id)
              : undefined
          }
          allowed={
            !!available && !mixed && !query.isFetching && !uncertain.isFetching && !roundAccepted
          }
          onDismiss={() => {
            returnFocus.current = selected.item.id;
            setSelected(null);
          }}
          onAccepted={onAccepted}
          onReconcile={refresh}
        />
      )}
    </>
  );
}
