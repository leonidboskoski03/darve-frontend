import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import { Panel } from '@/design-system/panel';
import { StatusBadge } from '@/design-system/status-badge';
import { LoadingState } from '@/design-system/loading-state';
import { coinAmount, coinTime } from '@/services/coins/index';
import {
  createTemplateClient,
  redemptionBlock,
  type TemplateClient,
  type RedemptionState,
} from '@/services/templates/index';
import type { CreatorSession } from '@/services/creator-session/index';
import './templates.css';

const displayNotice =
  'OBS display support pending. This template cannot currently be used in the Darve OBS display.';
function Review({ client, state }: { client: TemplateClient; state: RedemptionState }) {
  const [confirmed, setConfirmed] = useState(false);
  const [now, setNow] = useState(Date.now);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (state.phase !== 'uncertain' || state.retryAt <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.phase, state.retryAt]);
  const attempt = state.attempt;
  if (!attempt) return null;
  const pending = state.phase === 'pending',
    uncertain = state.phase === 'uncertain',
    sending = state.phase === 'sending';
  return (
    <section className="template-review" aria-labelledby="redemption-heading" aria-busy={sending}>
      <h2 id="redemption-heading" tabIndex={-1} ref={heading}>
        {pending
          ? 'Ownership verification pending'
          : uncertain
            ? 'Redemption result unconfirmed'
            : sending
              ? 'Submitting redemption…'
              : 'Review redemption'}
      </h2>
      <p>
        <strong>{attempt.name}</strong> · {coinAmount(attempt.input.amount)} coins
      </p>
      {attempt.templateId !== 'standalone' && <p className="templates-warning">{displayNotice}</p>}
      {pending ? (
        <p role="status">
          The request was recorded. Refresh ownership to check verification. Do not start a
          replacement redemption.
        </p>
      ) : (
        <>
          {uncertain && (
            <p role="alert">
              Keep this page open. The result could not be confirmed. Refresh ownership, or
              deliberately retry only this same reviewed request. Do not start a replacement
              redemption.
            </p>
          )}
          <p>
            Ownership is permanent for this template, including future versions. Availability and
            OBS display support are separate. Coins are not a payment or cash balance.
          </p>
          <label className="template-confirmation">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={sending}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I reviewed the {coinAmount(attempt.input.amount)} coin cost and understand the current
              OBS display limitation.
            </span>
          </label>
          <div className="templates-actions">
            <Button
              disabled={!confirmed || sending || now < state.retryAt}
              onClick={() => {
                void client.redeem(confirmed).catch(() => undefined);
              }}
            >
              {sending ? 'Submitting…' : uncertain ? 'Retry same redemption' : 'Confirm redemption'}
            </Button>
            {state.phase === 'review' && (
              <Button
                tone="quiet"
                onClick={() => {
                  client.cancelReview();
                  window.requestAnimationFrame(() =>
                    document.getElementById('template-' + attempt.templateId)?.focus(),
                  );
                }}
              >
                Cancel review
              </Button>
            )}
          </div>
          {uncertain && now < state.retryAt && (
            <p role="status">
              Wait {Math.ceil((state.retryAt - now) / 1000)} seconds before retrying this request.
            </p>
          )}
        </>
      )}
    </section>
  );
}
function Outcome({ state }: { state: RedemptionState }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [state.phase]);
  if (!['rejected', 'confirmed'].includes(state.phase)) return null;
  const price = state.error?.code === 'PRICE_CHANGED';
  return (
    <section className="template-result" aria-labelledby="template-result-heading">
      <h2 ref={heading} tabIndex={-1} id="template-result-heading">
        {state.phase === 'confirmed'
          ? 'Ownership verified'
          : price
            ? 'Price changed — review again'
            : 'Redemption was not completed'}
      </h2>
      <p role="status">
        {state.phase === 'confirmed'
          ? 'The backend confirms ownership. Coin history shows recorded coin activity. OBS availability is shown separately.'
          : price
            ? 'No replacement request was sent. Refresh the catalogue and review its current price before confirming again.'
            : 'The server rejected this request. Refresh current coins, ownership and availability before making a new review.'}
      </p>
    </section>
  );
}
export function Templates({
  session,
  ownedOnly,
  navigation,
  coinHistory,
}: {
  session: CreatorSession;
  ownedOnly: boolean;
  navigation: ReactNode;
  coinHistory: ReactNode;
}) {
  const client = useMemo(() => createTemplateClient(session), [session]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [reviewError, setReviewError] = useState(false);
  const query = useQuery({
    queryKey: client.scope.key(['templates', 'resources']),
    queryFn: ({ signal }) => client.resources(signal),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const refetch = query.refetch;
  useEffect(() => {
    if (['pending', 'uncertain', 'rejected'].includes(state.phase)) void refetch();
  }, [state.phase, refetch]);
  useEffect(() => {
    if (query.data && !query.isError && !client.scope.signal.aborted) client.reconcile(query.data);
  }, [query.data, query.isError, client, state.phase]);
  const data = !query.isError ? query.data : undefined;
  const templates = data?.catalogue.data.templates.filter((item) => !ownedOnly || item.owned);
  return (
    <div className="templates-page">
      <header className="templates-heading">
        <div>
          <h1>Templates</h1>
          <p>Review ownership, availability and the current coin cost.</p>
        </div>
        <Button
          tone="secondary"
          disabled={query.isFetching || state.phase === 'sending'}
          onClick={() => {
            void refetch();
          }}
        >
          {query.isFetching ? 'Checking ownership…' : 'Refresh ownership'}
        </Button>
      </header>
      <Panel title="Your coins" description="Only verified available coins can be redeemed.">
        {data ? (
          <>
            <dl className="templates-balance">
              <dt>Available coins</dt>
              <dd>{coinAmount(data.account.data.spendableBalance)}</dd>
            </dl>
            {!data.account.data.redemptionAllowed && (
              <p className="templates-warning">
                New redemptions are currently unavailable for this account. Recorded ownership
                remains visible.
              </p>
            )}
            {coinHistory}
          </>
        ) : query.isPending ? (
          <LoadingState label="Checking coins and ownership…" />
        ) : (
          <p role="alert">
            Current coins and ownership could not be verified. Refresh ownership before relying on
            these values.
          </p>
        )}
      </Panel>
      {state.attempt && (
        <Review key={state.attempt.key + state.phase} client={client} state={state} />
      )}
      <Outcome state={state} />
      {reviewError && (
        <p role="alert">A current review could not be prepared. Refresh ownership and try again.</p>
      )}
      <Panel
        title="Template catalogue"
        description="Owning a template does not guarantee that it is currently available for your OBS display."
      >
        {navigation}
        {templates && (
          <ul className="templates-list">
            {templates.map((item) => {
              const owned = data?.entitlements.data.templates.find((row) => row.id === item.id);
              const ownership = owned?.ownershipState ?? item.ownershipState;
              const block = data
                ? redemptionBlock(data, item)
                : 'Current ownership is unconfirmed.';
              return (
                <li key={item.id} className="template-row">
                  <div>
                    <h3>{item.displayName}</h3>
                    <div className="templates-actions">
                      <StatusBadge
                        tone={
                          ownership === 'owned'
                            ? 'success'
                            : ownership === 'synchronization_pending'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {ownership === 'owned'
                          ? 'Owned'
                          : ownership === 'synchronization_pending'
                            ? 'Ownership pending'
                            : 'Not owned'}
                      </StatusBadge>
                      {!item.available && <StatusBadge tone="warning">Unavailable</StatusBadge>}
                    </div>
                    <p className="templates-muted">
                      Version {item.assetVersion} ·{' '}
                      {item.amount === null
                        ? 'Price not configured'
                        : coinAmount(item.amount) + ' coins'}
                    </p>
                    {item.id !== 'standalone' ? (
                      <p className="templates-warning">{displayNotice}</p>
                    ) : (
                      <p className="templates-muted">
                        Included with Darve. Available in the current OBS display.
                      </p>
                    )}
                  </div>
                  <div className="template-row-action">
                    {ownership === 'not_owned' && (
                      <>
                        <Button
                          id={'template-' + item.id}
                          tone="secondary"
                          disabled={Boolean(block) || query.isFetching || Boolean(state.attempt)}
                          onClick={() => {
                            try {
                              client.prepare(data!, item.id);
                              setReviewError(false);
                            } catch {
                              setReviewError(true);
                            }
                          }}
                        >
                          Review {item.displayName}
                        </Button>
                        {block && <p className="templates-muted">{block}</p>}
                      </>
                    )}
                    {ownership === 'synchronization_pending' && (
                      <p className="templates-muted">
                        Ownership is recorded and awaiting verification. Refresh ownership; no new
                        redemption is needed.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {templates?.length === 0 && (
          <p>
            {ownedOnly
              ? 'No owned templates are currently recorded.'
              : 'No templates are currently listed.'}
          </p>
        )}
        {!data && !query.isPending && (
          <p>Catalogue unavailable until current information can be verified.</p>
        )}
        {data && (
          <p className="templates-muted templates-checked">
            Catalogue checked{' '}
            <time dateTime={data.catalogue.serverTime}>
              {coinTime(data.catalogue.serverTime)} UTC
            </time>
            . Refresh before a new review.
          </p>
        )}
      </Panel>
    </div>
  );
}
