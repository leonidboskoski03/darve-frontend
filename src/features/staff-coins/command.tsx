import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/design-system/button';
import { StaffCoinError, type StaffCoinClient } from '@/services/staff-coins/index';
import { staffCoinMessage } from './model';
export function Command({ client, refresh }: { client: StaffCoinClient; refresh: () => void }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot),
    [confirmed, setConfirmed] = useState(false),
    [cooling, setCooling] = useState(false),
    title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, [state.phase]);
  useEffect(() => {
    if (['recorded', 'rejected', 'uncertain'].includes(state.phase)) refresh();
  }, [state.phase, refresh]);
  useEffect(() => {
    if (!state.error) return;
    const delay = client.retryDelay();
    const timer = setTimeout(() => setCooling(false), delay);
    return () => clearTimeout(timer);
  }, [state.error, client]);
  if (state.phase === 'idle') return null;
  const held = state.attempt,
    sending = state.phase === 'sending';
  return (
    <section className="staff-coins-command" aria-labelledby="coin-command-title">
      <h2 id="coin-command-title" ref={title} tabIndex={-1}>
        {held ? 'Review coin change' : 'Coin request result'}
      </h2>
      {held ? (
        <>
          <p className="staff-coins-exact">{held.summary}</p>
          <p>Reason: {String(held.body.reason)}</p>
          <p>Reviewed revision: {String(held.body.expectedRevision)}</p>
          {state.phase === 'uncertain' ? (
            <p role="alert">
              Result unconfirmed. Keep this request. Retry sends its same key and exact values; do
              not create a replacement change.
            </p>
          ) : null}
          <label className="staff-coins-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={sending}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I reviewed this exact target, values, reason and revision.
          </label>
          <div className="staff-coins-actions">
            <Button
              disabled={sending || !confirmed || cooling}
              onClick={() => {
                void client
                  .execute(confirmed)
                  .then(() => {
                    setConfirmed(false);
                    setCooling(client.retryDelay() > 0);
                  })
                  .catch(() => undefined);
              }}
            >
              {sending
                ? 'Submitting coin change…'
                : state.phase === 'uncertain'
                  ? 'Retry same coin change'
                  : 'Confirm coin change'}
            </Button>
            {state.phase === 'review' ? (
              <Button tone="quiet" onClick={() => client.cancel()}>
                Cancel coin review
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <p role="status">
          {state.phase === 'recorded'
            ? state.outcome === 'synchronization_pending'
              ? 'The server recorded the adjustment. Synchronization is pending. Refresh the canonical account and history; this receipt does not verify an available balance.'
              : 'The server recorded the change. Current information is being read again.'
            : staffCoinMessage(new StaffCoinError(state.error!))}
        </p>
      )}
    </section>
  );
}
