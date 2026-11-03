import { useEffect, useState } from 'react';
import { Button } from '@/design-system/button';
import { SupportError } from '@/services/support/index';
import { errorCopy } from './model';
import type { useSupportCommand } from './use-command';
export function SupportFailure({ error, retry }: { error: unknown; retry: () => void }) {
  const seconds = error instanceof SupportError ? (error.problem.retryAfterSeconds ?? 0) : 0;
  const [waiting, setWaiting] = useState(seconds > 0);
  useEffect(() => {
    const timer = setTimeout(() => setWaiting(false), Math.min(300, seconds) * 1000);
    return () => clearTimeout(timer);
  }, [error, seconds]);
  return (
    <div className="support-notice" role="alert">
      <p>{errorCopy(error)}</p>
      <Button tone="secondary" disabled={waiting} onClick={retry}>
        {waiting ? 'Wait to refresh' : 'Refresh support'}
      </Button>
    </div>
  );
}
export function CommandFeedback({ command }: { command: ReturnType<typeof useSupportCommand> }) {
  const { busy, held, error, notice, cooling } = command;
  return (
    <>
      {notice ? (
        <p role="status" className="support-feedback">
          {notice}
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="support-notice">
          <p>
            {held
              ? 'The result is unconfirmed. Keep this conversation open. Retry only this same request; a fresh request could repeat the change.'
              : errorCopy(error)}
          </p>
          {held ? (
            <Button
              tone="secondary"
              disabled={busy || cooling}
              onClick={() => {
                command.retry();
              }}
            >
              {busy
                ? 'Checking request…'
                : cooling
                  ? 'Wait to retry'
                  : 'Retry same support request'}
            </Button>
          ) : null}
        </div>
      ) : null}
      {busy ? <p role="status">Confirming support request…</p> : null}
    </>
  );
}
