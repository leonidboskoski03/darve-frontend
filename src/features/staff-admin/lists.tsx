import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import type { StaffAdminClient, AdminSelection } from '@/services/staff-admin/index';
import type { AdminCommand } from './use-command';
import { ReviewedAction } from './reviewed-action';
import { MemberActions, InvitationActions } from './directory';
import { adminError } from './error';
export function AdminLists({
  client,
  selection,
  command,
  onSelect,
  epoch,
}: {
  client: StaffAdminClient;
  selection: AdminSelection;
  command: AdminCommand;
  onSelect: (next: AdminSelection) => void;
  epoch: number;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    [previous, setPrevious] = useState<(string | null)[]>([]);
  const query = useQuery({
    queryKey: client.scope.key([
      'staff-admin',
      'list',
      selection.view,
      selection.owner,
      selection.state,
      cursor,
      epoch,
    ]),
    gcTime: 0,
    queryFn: async ({ signal }) => {
      if (selection.view === 'challenges')
        return {
          kind: 'challenges' as const,
          ...(await client.challenges(selection.owner, cursor, signal)),
        };
      if (selection.view === 'staff')
        return { kind: 'staff' as const, ...(await client.members(cursor, signal)) };
      if (selection.view === 'audit')
        return { kind: 'audit' as const, ...(await client.audit(cursor, signal)) };
      return {
        kind: 'reviews' as const,
        ...(await client.reviews(selection.owner, selection.state, cursor, signal)),
      };
    },
  });
  const data = query.data;
  return (
    <section>
      {query.isPending ? (
        <p role="status">Loading current authorized records…</p>
      ) : query.isError ? (
        <p role="alert">{adminError(query.error)}</p>
      ) : data ? (
        <>
          <p>
            Showing this authorized page only. Refresh to check current access and newer records.
          </p>
          {!data.items.length ? <p>No records on this page.</p> : null}
          <ul className="staff-admin-records">
            {data.kind === 'challenges'
              ? data.items.map((row) => (
                  <li key={row.id}>
                    <h2>
                      {row.contentAvailable
                        ? (row.text ?? 'Text unavailable')
                        : 'Source content unavailable'}
                    </h2>
                    <p>
                      {row.provider} · {row.creatorDisplayName ?? 'Display name unavailable'}
                    </p>
                    <p>
                      <code>{row.id}</code>
                    </p>
                    <p>
                      Goal {row.goal.amountMinor} minor units · {row.goal.currency}. Stored funding
                      projection {row.funding ? 'revision ' + row.funding.revision : 'unavailable'}.
                    </p>
                    <Button
                      tone="secondary"
                      disabled={command.blocked}
                      onClick={() =>
                        onSelect({ view: 'challenge', id: row.id, owner: '', state: '' })
                      }
                    >
                      Inspect challenge
                    </Button>
                  </li>
                ))
              : null}
            {data.kind === 'reviews'
              ? data.items.map((row) => (
                  <li key={row.id + ':' + row.revision}>
                    <h2>
                      Review {row.id.slice(0, 8)} · {row.state.replaceAll('_', ' ')}
                    </h2>
                    <p className="staff-admin-id">
                      Review ID <code>{row.id}</code> · Revision {row.revision}
                    </p>
                    <p>
                      Creator <code>{row.userId}</code>
                      {row.challengeId ? (
                        <>
                          {' '}
                          · Challenge <code>{row.challengeId}</code>
                        </>
                      ) : null}
                    </p>
                    <dl>
                      <dt>Original flag reason</dt>
                      <dd>{row.flagReason}</dd>
                      <dt>Current action reason</dt>
                      <dd>{row.reason}</dd>
                    </dl>
                    <p>Updated {new Date(row.updatedAt).toLocaleString()}.</p>
                    <Button
                      tone="quiet"
                      disabled={command.blocked}
                      onClick={() =>
                        onSelect({
                          view: row.challengeId ? 'challenge' : 'streamer',
                          id: row.challengeId ?? row.userId,
                          owner: '',
                          state: '',
                        })
                      }
                    >
                      Inspect review target
                    </Button>
                    {client.access.getSnapshot().permissions.includes('review.resolve') &&
                    row.state !== 'resolved' ? (
                      <ReviewedAction
                        title="Advance manual review"
                        label="Confirm review transition"
                        summary={
                          'Move review ' +
                          row.id +
                          ' from ' +
                          row.state +
                          ' to ' +
                          (row.state === 'open' ? 'in_review' : 'resolved') +
                          ' at revision ' +
                          row.revision +
                          '. This does not create or remove a ban.'
                        }
                        command={command}
                        prepare={(reason) => client.prepareTransition(row, reason)}
                      />
                    ) : null}
                  </li>
                ))
              : null}
            {data.kind === 'staff'
              ? data.items.map((row) => (
                  <li key={row.id + ':' + row.revision}>
                    <h2>
                      {row.role === 'OWNER_ADMIN' ? 'Owner administrator' : 'Support'} ·{' '}
                      {row.active ? 'Active' : 'Inactive'}
                    </h2>
                    <p>
                      <code>{row.id}</code> · Revision {row.revision}
                    </p>
                    <MemberActions client={client} member={row} command={command} />
                  </li>
                ))
              : null}
            {data.kind === 'audit'
              ? data.items.map((row) => (
                  <li key={row.id}>
                    <h2>{row.action}</h2>
                    <p>{new Date(row.createdAt).toLocaleString()}</p>
                    <dl>
                      <dt>Actor</dt>
                      <dd>{row.actorId ?? 'System'}</dd>
                      <dt>Resource</dt>
                      <dd>{row.resourceId}</dd>
                      <dt>Reason</dt>
                      <dd>{row.reason}</dd>
                    </dl>
                  </li>
                ))
              : null}
          </ul>
          <div className="staff-admin-toolbar">
            <Button
              tone="secondary"
              disabled={command.blocked || !previous.length}
              onClick={() => {
                setCursor(previous.at(-1) ?? null);
                setPrevious((rows) => rows.slice(0, -1));
              }}
            >
              Previous records
            </Button>
            <Button
              tone="secondary"
              disabled={command.blocked || !data.nextCursor}
              onClick={() => {
                setPrevious((rows) => [...rows, cursor]);
                setCursor(data.nextCursor);
              }}
            >
              Next records
            </Button>
          </div>
        </>
      ) : null}
      {selection.view === 'staff' ? <InvitationActions client={client} command={command} /> : null}
    </section>
  );
}
