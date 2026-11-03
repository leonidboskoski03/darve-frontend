import { useState } from 'react';
import { Button } from '@/design-system/button';
import type { AdminCommand } from './use-command';
import { adminError } from './error';
export function AdminFeedback({ command }: { command: AdminCommand }) {
  const [shown, setShown] = useState(false);
  const target =
    command.held?.id ??
    command.held?.body.targetId ??
    command.held?.body.email ??
    command.held?.body.subject;
  const version = command.held?.body.expectedVersion;
  return (
    <section aria-label="Staff action result">
      {command.busy ? <p role="status">Confirming staff action…</p> : null}
      {command.notice ? <p role="status">{command.notice}</p> : null}
      {command.error ? (
        <div role="alert" className="staff-admin-notice">
          <p>
            {command.held
              ? 'The result is unconfirmed. Keep this page open. Retry only this exact held request; do not prepare a replacement.'
              : adminError(command.error)}
          </p>
          {command.held ? (
            <p>
              Held action: {command.held.kind}. Target:{' '}
              <code>{typeof target === 'string' ? target : 'reviewed identity'}</code>.{' '}
              {typeof version === 'number' ? 'Reviewed revision: ' + version.toString() + '. ' : ''}
              The original reason and request are retained.
            </p>
          ) : null}
          {command.held ? (
            <Button
              tone="secondary"
              disabled={command.busy || command.cooling}
              onClick={command.retry}
            >
              {command.busy
                ? 'Checking request…'
                : command.cooling
                  ? 'Wait before retrying'
                  : 'Retry same staff action'}
            </Button>
          ) : null}
        </div>
      ) : null}
      {command.invitation ? (
        <div className="staff-admin-notice">
          <h2>Invitation recorded</h2>
          <p>
            Invitation ID: <code>{command.invitation.id}</code>. Role: {command.invitation.role}.
            State: {command.invitation.state}. Expires{' '}
            {new Date(command.invitation.expiresAt).toLocaleString()}.
          </p>
          {command.invitation.acceptanceUrl ? (
            <>
              <p>
                This private one-use link is available only in this mounted result. Copy it securely
                before refreshing or leaving. Creating an invitation does not send an email.
              </p>
              <Button tone="secondary" onClick={() => setShown((value) => !value)}>
                {shown ? 'Hide private invitation link' : 'Show private invitation link'}
              </Button>
              {shown ? (
                <label className="staff-admin-private">
                  Private invitation link
                  <input
                    className="ds-input"
                    readOnly
                    value={command.invitation.acceptanceUrl}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
              ) : null}
            </>
          ) : (
            <p>
              This replay confirms the existing invitation but cannot recover its private link.
              Revoke the known invitation explicitly if it needs replacing.
            </p>
          )}
          <Button tone="quiet" onClick={command.clearResult}>
            Dismiss invitation result
          </Button>
        </div>
      ) : null}
    </section>
  );
}
