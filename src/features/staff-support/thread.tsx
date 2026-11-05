import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import {
  StaffSupportError,
  subscribeStaffSupport,
  type StaffSupportClient,
  type StaffSupportStreamPhase,
} from '@/services/staff-support/index';
import { useStaffCommand } from './use-command';
import { CommandResult } from './command';
import { staffError } from './error';
import { TicketActions } from './ticket-actions';
import { TicketRecovery } from './recovery';
import { TicketCoins } from './coins';

export function StaffThread({
  client,
  id,
  onList,
}: {
  client: StaffSupportClient;
  id: string;
  onList: () => void;
}) {
  const [kind, setKind] = useState<'messages' | 'notes'>('messages'),
    [cursor, setCursor] = useState<string | null>(null),
    [previous, setPrevious] = useState<(string | null)[]>([]),
    [epoch, setEpoch] = useState(0),
    [body, setBody] = useState(''),
    [phase, setPhase] = useState<StaffSupportStreamPhase>('connecting'),
    [connection, setConnection] = useState(0);
  const reset = useCallback(() => {
    const key = client.scope.key(['staff-support', 'thread', id]);
    void client.scope.queryClient.cancelQueries({ queryKey: key });
    client.scope.queryClient.removeQueries({ queryKey: key });
    const recoveryKey = client.scope.key(['staff-support', 'recovery', id]);
    void client.scope.queryClient.cancelQueries({ queryKey: recoveryKey });
    client.scope.queryClient.removeQueries({ queryKey: recoveryKey });
    setBody('');
    setCursor(null);
    setPrevious([]);
    setEpoch((value) => value + 1);
  }, [client, id]);
  useEffect(
    () =>
      subscribeStaffSupport({
        session: client.access,
        ticketId: id,
        onReset: reset,
        onPhase: setPhase,
        onDenied: onList,
      }),
    [client, id, reset, onList, connection],
  );
  const read = useQuery({
    queryKey: client.scope.key(['staff-support', 'thread', id, epoch, kind, cursor]),
    gcTime: 0,
    queryFn: async ({ signal }) => {
      try {
        return await client.thread(id, kind, cursor, signal);
      } catch (error) {
        if (!signal.aborted && error instanceof StaffSupportError) {
          if ([403, 404].includes(error.problem.status ?? 0)) onList();
          else if (cursor && error.problem.status === 409) reset();
        }
        throw error;
      }
    },
  });
  const command = useStaffCommand(client, () => reset(), reset);
  const data = read.data;
  const maximum = data?.page.items.at(-1)?.sequence ?? 0;
  const changeKind = (next: 'notes' | 'messages') => {
    setKind(next);
    reset();
  };
  return (
    <div className="staff-work-page">
      <Button tone="quiet" onClick={onList}>
        Back to support desk
      </Button>
      <header>
        <h1>Ticket {id.slice(0, 8)}</h1>
        <p>
          {phase === 'live'
            ? 'Connected to ticket updates'
            : phase === 'unavailable'
              ? 'Live updates unavailable. Refresh current information.'
              : 'Checking for ticket updates…'}
        </p>
        <div className="staff-work-toolbar">
          <Button tone="secondary" onClick={reset}>
            Refresh ticket
          </Button>
          {phase === 'unavailable' ? (
            <Button tone="quiet" onClick={() => setConnection((value) => value + 1)}>
              Reconnect ticket updates
            </Button>
          ) : null}
        </div>
      </header>
      {read.isPending ? (
        <p role="status">Loading the current authorized ticket…</p>
      ) : read.isError ? (
        <p role="alert">{staffError(read.error)}</p>
      ) : data ? (
        <>
          <div className="staff-work-ticket-meta">
            <span>{data.ticket.category}</span>
            <strong>{data.ticket.status.replaceAll('_', ' ')}</strong>
            <span>
              Assignment:{' '}
              {data.ticket.assigneeId === client.access.getSnapshot().staff?.id
                ? 'You'
                : (data.ticket.assigneeId ?? 'Unassigned')}
            </span>
          </div>
          <div className="staff-work-columns">
            <section aria-labelledby="staff-thread-heading">
              <div className="staff-work-toolbar" role="group" aria-label="Conversation visibility">
                <Button
                  tone={kind === 'messages' ? 'primary' : 'quiet'}
                  disabled={command.blocked}
                  onClick={() => changeKind('messages')}
                >
                  Creator conversation ({data.ticket.unread} unread)
                </Button>
                <Button
                  tone={kind === 'notes' ? 'primary' : 'quiet'}
                  disabled={
                    command.blocked ||
                    !client.access.getSnapshot().permissions.includes('tickets.note')
                  }
                  onClick={() => changeKind('notes')}
                >
                  Internal notes ({data.ticket.noteUnread} unread)
                </Button>
              </div>
              <h2 id="staff-thread-heading">
                {kind === 'messages' ? 'Creator conversation' : 'Internal staff notes'}
              </h2>
              {kind === 'notes' ? (
                <p className="staff-work-notice">
                  Internal only. Notes are never sent to the creator and have their own unread
                  position.
                </p>
              ) : (
                <p>
                  Public replies are visible to this ticket’s creator. Sending a reply alone does
                  not change ticket status.
                </p>
              )}
              <ol className="staff-work-messages">
                {data.page.items.map((message) => (
                  <li key={message.id}>
                    <div>
                      <strong>
                        {message.author === 'streamer'
                          ? 'Creator'
                          : kind === 'notes'
                            ? 'Staff note'
                            : 'Darve support'}
                      </strong>
                      <time dateTime={message.createdAt}>
                        {new Date(message.createdAt).toLocaleString()}
                      </time>
                    </div>
                    <p>
                      {message.redacted ? 'This message is no longer available.' : message.body}
                    </p>
                  </li>
                ))}
              </ol>
              {!data.page.items.length ? (
                <p>No {kind === 'notes' ? 'notes' : 'messages'} on this page.</p>
              ) : null}
              <div className="staff-work-toolbar">
                <Button
                  tone="secondary"
                  disabled={!previous.length || command.blocked}
                  onClick={() => {
                    setCursor(previous.at(-1) ?? null);
                    setPrevious((items) => items.slice(0, -1));
                  }}
                >
                  Previous history
                </Button>
                <Button
                  tone="secondary"
                  disabled={!data.page.nextCursor || command.blocked}
                  onClick={() => {
                    setPrevious((items) => [...items, cursor]);
                    setCursor(data.page.nextCursor);
                  }}
                >
                  Next history
                </Button>
              </div>
              {maximum >
              (kind === 'notes' ? data.ticket.noteReadSequence : data.ticket.readSequence) ? (
                <Button
                  tone="quiet"
                  disabled={command.blocked}
                  onClick={() =>
                    command.run(() =>
                      client.prepareTicket('read', data.ticket, {
                        sequence: maximum,
                        notes: kind === 'notes',
                      }),
                    )
                  }
                >
                  Mark displayed {kind === 'notes' ? 'notes' : 'conversation'} as read
                </Button>
              ) : (
                <p>Displayed {kind === 'notes' ? 'notes' : 'conversation'} marked as read.</p>
              )}
              <form
                className="staff-work-compose"
                onSubmit={(event) => {
                  event.preventDefault();
                  command.run(() =>
                    client.prepareTicket(kind === 'notes' ? 'note' : 'reply', data.ticket, {
                      body,
                    }),
                  );
                }}
              >
                <h3>{kind === 'notes' ? 'Add an internal note' : 'Reply to the creator'}</h3>
                <label htmlFor="staff-work-body">
                  {kind === 'notes' ? 'Internal note (required)' : 'Creator reply (required)'}
                </label>
                <textarea
                  id="staff-work-body"
                  className="ds-input"
                  required
                  maxLength={8000}
                  disabled={command.blocked}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
                <p>
                  {body.length.toLocaleString()} / 8,000 characters. Server limits may be lower.
                  Drafts clear when current information is reloaded.
                </p>
                <Button type="submit" disabled={command.blocked || !body.trim()}>
                  {kind === 'notes' ? 'Save internal note' : 'Send creator reply'}
                </Button>
              </form>
            </section>
            <aside>
              <TicketActions
                key={epoch}
                client={client}
                ticket={data.ticket}
                disabled={command.blocked}
                command={command}
              />
              <section className="staff-work-context">
                <h2>Ticket context</h2>
                <p>Only this ticket’s currently authorized context is listed.</p>
                <ul>
                  {data.ticket.contexts.map((context) => (
                    <li key={context.kind + context.id}>
                      {context.kind}
                      <code>{context.id}</code>
                    </li>
                  ))}
                </ul>
                {!data.ticket.contexts.length ? <p>No context attached.</p> : null}
              </section>
            </aside>
          </div>
          {phase === 'live' &&
          (client.access.getSnapshot().permissions.includes('coins.assigned.read') ||
            client.access.getSnapshot().permissions.includes('coins.read')) ? (
            <TicketCoins key={'coins:' + epoch} client={client} id={id} epoch={epoch} />
          ) : null}
          {client.access.getSnapshot().role === 'OWNER_ADMIN' &&
          client.access.getSnapshot().permissions.includes('tickets.context.write') ? (
            <TicketRecovery
              key={'recovery:' + epoch}
              client={client}
              ticket={data.ticket}
              command={command}
              epoch={epoch}
            />
          ) : null}
        </>
      ) : null}
      <CommandResult command={command} />
    </div>
  );
}
