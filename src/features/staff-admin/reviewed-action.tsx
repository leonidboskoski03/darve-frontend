import { useId, useState } from 'react';
import { Button } from '@/design-system/button';
import { TextField } from '@/design-system/text-field';
import type { AdminAttempt } from '@/services/staff-admin/index';
import type { AdminCommand } from './use-command';
export function ReviewedAction({
  title,
  summary,
  label,
  prepare,
  command,
  disabled = false,
}: {
  title: string;
  summary: string;
  label: string;
  prepare: (reason: string) => AdminAttempt;
  command: AdminCommand;
  disabled?: boolean;
}) {
  const id = useId();
  const [reason, setReason] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const blocked = command.blocked || disabled;
  return (
    <form
      className="staff-admin-action"
      aria-labelledby={id}
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmed) command.run(() => prepare(reason));
      }}
    >
      <h3 id={id}>{title}</h3>
      <p className="staff-admin-binding">{summary}</p>
      <TextField
        label={title + ' reason'}
        required
        maxLength={2000}
        disabled={blocked}
        value={reason}
        onChange={(event) => {
          setReason(event.target.value);
          setConfirmed(false);
        }}
      />
      <label className="staff-admin-check">
        <input
          type="checkbox"
          disabled={blocked}
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>I reviewed this exact target, action, reason and current version.</span>
      </label>
      <Button type="submit" tone="secondary" disabled={blocked || !reason.trim() || !confirmed}>
        {label}
      </Button>
    </form>
  );
}
