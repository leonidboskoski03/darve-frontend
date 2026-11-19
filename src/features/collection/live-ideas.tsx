import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Sparkles, Users } from 'lucide-react';
import { LayoutList } from '@/motion/layout-list';
import { createAnalysisLiveSubscription } from '@/services/realtime/index';
import type { AuthorityScope } from '@/services/server-state/index';

function IdeaRow({
  order,
  title,
  supporterCount,
  reason,
}: {
  order: number;
  title: string;
  supporterCount: number;
  reason?: string;
}) {
  return (
    <div className="collection-idea">
      <span className="collection-idea__rank" aria-label={`Rank ${order}`}>
        {order}
      </span>
      <div className="collection-idea__body">
        {/* Viewer-written text: always rendered as text, never markup. */}
        <p className="collection-idea__title">{title}</p>
        {reason ? <p className="collection-idea__reason">{reason}</p> : null}
      </div>
      <span
        className="collection-idea__support"
        aria-label={`${supporterCount} ${supporterCount === 1 ? 'supporter' : 'supporters'}`}
      >
        <Users size={15} aria-hidden="true" />
        {supporterCount}
      </span>
    </div>
  );
}

/** Live preview during the countdown, then the published top ten. Display only: review owns acceptance. */
export function CollectionLiveIdeas({
  origin,
  scope,
  roundId,
  showStatus = true,
}: {
  origin: string;
  scope: AuthorityScope;
  roundId: string;
  showStatus?: boolean;
}) {
  const subscription = useMemo(
    () => createAnalysisLiveSubscription({ origin, roundId, scope }),
    [origin, roundId, scope],
  );
  useEffect(() => {
    subscription.start();
    return () => subscription.stop();
  }, [subscription]);
  const live = useSyncExternalStore(subscription.subscribe, subscription.getSnapshot);
  const reviewHref = `/collection/${encodeURIComponent(roundId)}/suggestions`;
  const result = live.result;
  const unavailable = ['denied', 'unavailable', 'protocol_error'].includes(live.phase);

  const status = unavailable
    ? 'Live ideas are unavailable right now. Your collection continues on the server; open review after it ends.'
    : live.roundState === 'failed'
      ? 'Analysis could not finish. Open review for the latest state.'
      : result
        ? result.suggestions.length === 0
          ? 'No eligible ideas were selected.'
          : result.settling
            ? 'Supporter counts are still updating. The order is final.'
            : 'Final top ideas.'
        : live.roundState === 'closing'
          ? 'Collection ended. Picking the top 10…'
          : live.phase === 'reconnecting'
            ? 'Reconnecting to live ideas…'
            : live.phase === 'idle' || live.phase === 'connecting'
              ? 'Connecting to live ideas…'
              : live.preview.length === 0
                ? 'Waiting for the first ideas. An idea appears here after its safety check.'
                : 'Updates while viewers send ideas.';

  return (
    <section className="collection-panel collection-ideas" aria-labelledby="live-ideas-title">
      <div className="collection-ideas__heading">
        <h2 id="live-ideas-title">
          <Sparkles size={18} aria-hidden="true" />
          {result?.suggestions.length
            ? 'Top 10 ideas'
            : result
              ? 'Viewer ideas'
              : 'Top ideas right now'}
        </h2>
        {result ? (
          result.provisional ? (
            <span className="collection-ideas__badge collection-ideas__badge--provisional">
              Provisional
            </span>
          ) : null
        ) : live.roundState !== 'failed' && !unavailable ? (
          <span className="collection-ideas__badge">Live preview, not final</span>
        ) : null}
      </div>
      {showStatus || (unavailable && !result) ? (
        <p role="status" className="collection-muted">
          {showStatus ? status : 'Live preview is unavailable.'}
        </p>
      ) : null}
      {result && result.provisional ? (
        <p className="collection-muted">
          Picked from ideas that were already checked when the round closed.
        </p>
      ) : null}
      {result && result.suggestions.length > 0 ? (
        <LayoutList
          label="Top 10 ideas"
          className="collection-ideas__list"
          items={result.suggestions.map((idea) => ({
            id: idea.id,
            content: <IdeaRow {...idea} />,
          }))}
        />
      ) : !result && live.preview.length > 0 && live.roundState !== 'failed' ? (
        <LayoutList
          label="Live preview of top ideas"
          className="collection-ideas__list"
          items={live.preview.map((idea) => ({ id: idea.id, content: <IdeaRow {...idea} /> }))}
        />
      ) : null}
      {result || live.roundState === 'failed' ? (
        <a className="collection-ideas__review" href={reviewHref}>
          Review and accept a challenge
        </a>
      ) : null}
    </section>
  );
}
