import { Button } from '@/design-system/button';
import type { useStaffCommand } from './use-command';
import { staffError } from './error';
export function CommandResult({ command }: { command: ReturnType<typeof useStaffCommand> }) {
  return (
    <>
      {command.notice ? (
        <p role="status" className="staff-work-notice">
          {command.notice}
        </p>
      ) : null}
      {command.error ? (
        <div role="alert" className="staff-work-error">
          <p>
            {command.held
              ? 'The result is unconfirmed. Keep this page open and retry only this exact held request. Do not prepare a replacement.'
              : staffError(command.error)}
          </p>
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
                  : 'Retry same staff request'}
            </Button>
          ) : null}
        </div>
      ) : null}
      {command.busy ? <p role="status">Confirming staff request…</p> : null}
    </>
  );
}
