import { useState } from 'react';
import { Button } from '@/design-system/button';
import { TextField } from '@/design-system/text-field';
import type { StaffSupportClient, StaffTicket } from '@/services/staff-support/index';
import type { useStaffCommand } from './use-command';

export function TicketActions({
  client,
  ticket,
  disabled,
  command,
}: {
  client: StaffSupportClient;
  ticket: StaffTicket;
  disabled: boolean;
  command: ReturnType<typeof useStaffCommand>;
}) {
  const [status, setStatus] = useState<StaffTicket['status']>('in_progress'),
    [reason, setReason] = useState(''),
    [reply, setReply] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [target, setTarget] = useState(''),
    [assignmentReason, setAssignmentReason] = useState(''),
    [assignmentConfirmed, setAssignmentConfirmed] = useState(false);
  const blocked = disabled || command.blocked;
  return (
    <section className="staff-work-actions">
      <h2>Ticket actions</h2>
      {ticket.status === 'resolved' ? (
        <p>This ticket is resolved. A creator reply can reopen it.</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmed)
              command.run(() => client.prepareTicket('status', ticket, { status, reason, reply }));
          }}
        >
          <h3>Change status</h3>
          <label htmlFor="staff-work-status">New ticket status</label>
          <select
            id="staff-work-status"
            className="ds-input"
            disabled={blocked}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as StaffTicket['status']);
              setConfirmed(false);
            }}
          >
            <option value="in_progress">In progress</option>
            <option value="waiting_for_streamer">Waiting for creator</option>
            <option value="resolved">Resolved</option>
          </select>
          <TextField
            label="Status reason"
            required
            maxLength={2000}
            disabled={blocked}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setConfirmed(false);
            }}
          />
          <label htmlFor="staff-work-status-reply">Optional creator-visible reply</label>
          <textarea
            id="staff-work-status-reply"
            className="ds-input"
            maxLength={8000}
            disabled={blocked}
            value={reply}
            onChange={(event) => {
              setReply(event.target.value);
              setConfirmed(false);
            }}
          />
          <label className="staff-work-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={blocked}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>I reviewed this status change and any creator-visible reply.</span>
          </label>
          <Button
            type="submit"
            tone="secondary"
            disabled={blocked || !confirmed || !reason.trim() || status === ticket.status}
          >
            Confirm status change
          </Button>
        </form>
      )}
      {client.access.getSnapshot().permissions.includes('tickets.reassign') &&
      ticket.status !== 'resolved' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (assignmentConfirmed)
              command.run(() =>
                client.prepareTicket('reassign', ticket, {
                  assigneeId: target.trim(),
                  reason: assignmentReason,
                }),
              );
          }}
        >
          <h3>Reassign ticket</h3>
          <p>
            The target must be an eligible available staff member. The server rechecks this at
            assignment.
          </p>
          <TextField
            label="Target staff ID"
            required
            disabled={blocked}
            value={target}
            onChange={(event) => {
              setTarget(event.target.value);
              setAssignmentConfirmed(false);
            }}
          />
          <TextField
            label="Reassignment reason"
            required
            maxLength={2000}
            disabled={blocked}
            value={assignmentReason}
            onChange={(event) => {
              setAssignmentReason(event.target.value);
              setAssignmentConfirmed(false);
            }}
          />
          <label className="staff-work-check">
            <input
              type="checkbox"
              checked={assignmentConfirmed}
              disabled={blocked}
              onChange={(event) => setAssignmentConfirmed(event.target.checked)}
            />
            <span>I reviewed the exact target staff ID and reassignment reason.</span>
          </label>
          <Button
            type="submit"
            tone="secondary"
            disabled={blocked || !assignmentConfirmed || !target.trim() || !assignmentReason.trim()}
          >
            Confirm reassignment
          </Button>
        </form>
      ) : null}
    </section>
  );
}
