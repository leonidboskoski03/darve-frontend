import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import { TextField } from '@/design-system/text-field';
import type { RecoveryRead, StaffTicket, StaffSupportClient } from '@/services/staff-support/index';
import type { useStaffCommand } from './use-command';
import { staffError } from './error';
const reasons: Record<string, string> = {
  resolved_ticket: 'This ticket is resolved.',
  source_unavailable: 'The original challenge source is unavailable.',
  account_restricted: 'This creator is currently restricted.',
  already_declared: 'Performance was already declared.',
  undisclosed_policy:
    'This challenge did not accept the extension disclosure. Its funding deadline cannot be extended.',
  funding_closed: 'The funding window is closed. An extension cannot reopen it.',
  goal_reached: 'The funding goal is already reached or funding is no longer pending.',
  limit_reached: 'The configured cumulative extension limit has been reached.',
  no_verified_replacement:
    'No current verified replacement stream is available. Ask the creator to refresh their connected live-stream discovery, then refresh this ticket.',
};
type Command = ReturnType<typeof useStaffCommand>;
export function TicketRecovery({
  client,
  ticket,
  command,
  epoch,
}: {
  client: StaffSupportClient;
  ticket: StaffTicket;
  command: Command;
  epoch: number;
}) {
  const challenges = ticket.contexts.filter((context) => context.kind === 'challenge');
  const [selected, setSelected] = useState(challenges[0]?.id ?? '');
  if (!challenges.length)
    return (
      <section className="staff-work-context">
        <h2>Audited recovery</h2>
        <p>
          Recovery requires a currently linked challenge context. No challenge is linked to this
          ticket.
        </p>
      </section>
    );
  const id = challenges.some((row) => row.id === selected) ? selected : challenges[0]!.id;
  return (
    <section className="staff-work-context">
      <h2>Audited recovery</h2>
      <p>
        These actions keep original terms and financial history. The server checks current policy,
        source, deadlines and staff assurance before committing.
      </p>
      <label htmlFor="recovery-challenge">Linked recovery challenge</label>
      <select
        id="recovery-challenge"
        className="ds-input"
        value={id}
        disabled={command.blocked}
        onChange={(event) => setSelected(event.target.value)}
      >
        {challenges.map((row) => (
          <option key={row.id} value={row.id}>
            {row.id}
          </option>
        ))}
      </select>
      <RecoveryReadPanel
        key={id + ':' + epoch}
        client={client}
        ticket={ticket}
        id={id}
        command={command}
      />
    </section>
  );
}
function RecoveryReadPanel({
  client,
  ticket,
  id,
  command,
}: {
  client: StaffSupportClient;
  ticket: StaffTicket;
  id: string;
  command: Command;
}) {
  const query = useQuery({
    queryKey: client.scope.key([
      'staff-support',
      'recovery',
      ticket.id,
      id,
      ticket.staffRevision,
      ticket.contextRevision,
      ticket.authorityRevision,
    ]),
    gcTime: 0,
    queryFn: ({ signal }) => client.recovery(ticket, id, signal),
  });
  if (query.isPending) return <p role="status">Checking current recovery prerequisites…</p>;
  if (query.isError) return <p role="alert">{staffError(query.error)}</p>;
  if (query.data.data.state === 'disabled')
    return (
      <p>
        Recovery is disabled or its policy and consumer readiness are not configured together. No
        recovery action is available.
      </p>
    );
  return (
    <RecoveryForms
      key={query.data.receivedAt}
      client={client}
      read={query.data}
      command={command}
    />
  );
}
function RecoveryForms({
  client,
  read,
  command,
}: {
  client: StaffSupportClient;
  read: RecoveryRead;
  command: Command;
}) {
  const [seconds, setSeconds] = useState(''),
    [reason, setReason] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [replacement, setReplacement] = useState(''),
    [continuationReason, setContinuationReason] = useState(''),
    [continuationConfirmed, setContinuationConfirmed] = useState(false),
    [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const current = read.data;
  if (current.state !== 'ready') return null;
  const window = current.fundingWindow,
    now = client.recoveryNow(read);
  const maximum = window
    ? Math.min(
        current.policy.maximumExtensionSeconds,
        current.policy.maximumCumulativeSeconds - window.cumulativeSeconds,
      )
    : 0;
  const validSeconds = /^[1-9][0-9]{0,9}$/.test(seconds) && Number(seconds) <= maximum;
  const proposed =
    window && validSeconds
      ? new Date(Date.parse(window.effectiveClosesAt) + Number(seconds) * 1000).toISOString()
      : null;
  const extensionAllowed =
    current.extension.available && window !== null && now < Date.parse(window.effectiveClosesAt);
  const candidate = current.replacements.find((row) => row.id === replacement),
    candidateFresh = candidate && now < Date.parse(candidate.validUntil);
  const revisions =
    'Ticket ' +
    current.ticketRevision +
    ' · context ' +
    current.contextRevision +
    ' · assignment ' +
    current.authorityRevision +
    ' · funding ' +
    current.fundingRevision +
    ' · performance ' +
    current.performanceRevision;
  return (
    <div className="staff-work-recovery">
      <p>
        Configured policy {current.policy.version}. All numeric limits below come from the server.
        Command limit: {current.policy.maximumCommandsPerMinute} per minute.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (confirmed)
            command.run(() =>
              client.prepareRecovery(read, 'extension', { reason, addedSeconds: seconds }),
            );
        }}
      >
        <h3>Extend funding deadline</h3>
        {window ? (
          <>
            <p>{window.disclosure}</p>
            <dl>
              <dt>Original accepted deadline</dt>
              <dd>
                <time dateTime={window.originalClosesAt}>{window.originalClosesAt}</time>
              </dd>
              <dt>Current effective deadline</dt>
              <dd>
                <time dateTime={window.effectiveClosesAt}>{window.effectiveClosesAt}</time>
              </dd>
              <dt>Window revision / already added</dt>
              <dd>
                {window.revision} / {window.cumulativeSeconds} seconds
              </dd>
              <dt>Available additional time</dt>
              <dd>
                Up to {maximum} seconds for this action. Configured cumulative maximum:{' '}
                {current.policy.maximumCumulativeSeconds} seconds.
              </dd>
            </dl>
          </>
        ) : null}
        {!extensionAllowed ? (
          <p>
            {reasons[current.extension.reasonCode] ??
              'The deadline or current authority changed. Refresh this ticket before preparing an extension.'}
          </p>
        ) : null}
        <TextField
          label="Additional funding seconds"
          inputMode="numeric"
          required
          disabled={command.blocked || !extensionAllowed}
          value={seconds}
          onChange={(event) => {
            setSeconds(event.target.value);
            setConfirmed(false);
          }}
        />
        {proposed ? (
          <p>
            Proposed effective deadline: <time dateTime={proposed}>{proposed}</time>. The original
            accepted deadline stays {window?.originalClosesAt}.
          </p>
        ) : null}
        <TextField
          label="Extension reason"
          required
          maxLength={2000}
          disabled={command.blocked || !extensionAllowed}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setConfirmed(false);
          }}
        />
        <p className="staff-work-revision">{revisions}</p>
        <label className="staff-work-check">
          <input
            type="checkbox"
            disabled={command.blocked || !extensionAllowed || !validSeconds}
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            I reviewed this exact challenge, reason, current and proposed deadline, limits and
            revisions. The new cutoff also applies to payments already started.
          </span>
        </label>
        <Button
          type="submit"
          tone="secondary"
          disabled={
            command.blocked || !extensionAllowed || !validSeconds || !reason.trim() || !confirmed
          }
        >
          Confirm funding extension
        </Button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (continuationConfirmed)
            command.run(() =>
              client.prepareRecovery(read, 'continuation', {
                reason: continuationReason,
                replacementId: replacement,
              }),
            );
        }}
      >
        <h3>Authorize performance continuation</h3>
        <p>
          This authorizes a verified replacement broadcast for a later creator declaration. It does
          not declare completion, reset funding or transfer payments.
        </p>
        <dl>
          <dt>Immutable original broadcast</dt>
          <dd>
            <code>{current.performanceAuthority.originalBroadcastId}</code>
          </dd>
          <dt>Currently authorized broadcast</dt>
          <dd>
            <code>{current.performanceAuthority.broadcastId}</code>
          </dd>
        </dl>
        {!current.continuation.available ? (
          <p>
            {reasons[current.continuation.reasonCode] ??
              'Continuation is unavailable. Refresh current ticket authority.'}
          </p>
        ) : null}
        <label htmlFor="recovery-replacement">Verified replacement stream</label>
        <select
          id="recovery-replacement"
          className="ds-input"
          value={replacement}
          disabled={command.blocked || !current.continuation.available}
          onChange={(event) => {
            setReplacement(event.target.value);
            setContinuationConfirmed(false);
          }}
        >
          <option value="">Choose a verified replacement</option>
          {current.replacements.map((row) => (
            <option key={row.id} value={row.id}>
              {row.provider} · {row.id}
            </option>
          ))}
        </select>
        {candidate ? (
          <p>
            Replacement <code>{candidate.id}</code>. Verified at {candidate.observedAt}; evidence
            expires {candidate.validUntil}.{' '}
            {!candidateFresh
              ? 'Evidence expired. Ask the creator to refresh live discovery and refresh this ticket.'
              : ''}
          </p>
        ) : null}
        {current.replacementsTruncated ? (
          <p>
            This is a bounded list of verified candidates. Refresh creator discovery if the intended
            stream is not shown.
          </p>
        ) : null}
        <TextField
          label="Continuation reason"
          required
          maxLength={2000}
          disabled={command.blocked || !current.continuation.available}
          value={continuationReason}
          onChange={(event) => {
            setContinuationReason(event.target.value);
            setContinuationConfirmed(false);
          }}
        />
        <p className="staff-work-revision">{revisions}</p>
        <label className="staff-work-check">
          <input
            type="checkbox"
            disabled={command.blocked || !candidateFresh || !current.continuation.available}
            checked={continuationConfirmed}
            onChange={(event) => setContinuationConfirmed(event.target.checked)}
          />
          <span>
            I reviewed this challenge, immutable original and exact replacement broadcast, reason
            and revisions. Completion still requires a separate creator declaration.
          </span>
        </label>
        <Button
          type="submit"
          tone="secondary"
          disabled={
            command.blocked ||
            !candidateFresh ||
            !current.continuation.available ||
            !continuationReason.trim() ||
            !continuationConfirmed
          }
        >
          Confirm performance continuation
        </Button>
      </form>
    </div>
  );
}
