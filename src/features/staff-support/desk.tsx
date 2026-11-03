import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import { TextField } from '@/design-system/text-field';
import type { StaffSupportClient, QueueItem, StaffTicket } from '@/services/staff-support/index';
import { useStaffCommand } from './use-command';
import { CommandResult } from './command';
import { staffError } from './error';
const date = (value: string) => new Date(value).toLocaleString();
export function StaffDesk({
  client,
  onOpen,
}: {
  client: StaffSupportClient;
  onOpen: (id: string) => void;
}) {
  const [view, setView] = useState<'tickets' | 'queue'>('tickets'),
    [cursor, setCursor] = useState<string | null>(null),
    [previous, setPrevious] = useState<(string | null)[]>([]),
    [epoch, setEpoch] = useState(0),
    [claim, setClaim] = useState<QueueItem | null>(null),
    [reason, setReason] = useState('');
  const key = client.scope.key(['staff-support', 'desk']);
  const refresh = () => {
    void client.scope.queryClient.cancelQueries({ queryKey: key });
    client.scope.queryClient.removeQueries({ queryKey: key });
    setCursor(null);
    setPrevious([]);
    setClaim(null);
    setReason('');
    setEpoch((value) => value + 1);
  };
  const availability = useQuery({
    queryKey: [...key, 'availability', epoch],
    queryFn: ({ signal }) => client.availability(signal),
    gcTime: 0,
  });
  const permittedQueue =
    client.access.getSnapshot().role === 'OWNER_ADMIN' || availability.data?.available === true;
  const page = useQuery({
    queryKey: [...key, view, epoch, cursor],
    queryFn: ({ signal }) => client.page(view, cursor, signal),
    gcTime: 0,
    enabled: view !== 'queue' || permittedQueue,
  });
  const command = useStaffCommand(
    client,
    (id) => {
      refresh();
      if (id) onOpen(id);
    },
    refresh,
  );
  const changeView = (next: 'queue' | 'tickets') => {
    setView(next);
    refresh();
  };
  return (
    <div className="staff-work-page">
      <header>
        <h1>Support desk</h1>
        <p>
          {client.access.getSnapshot().role === 'OWNER_ADMIN'
            ? 'Review tickets across the support workspace.'
            : 'Work on your assigned conversations or explicitly claim queued work.'}
        </p>
      </header>
      <section className="staff-work-availability" aria-labelledby="availability-title">
        <div>
          <h2 id="availability-title">Your availability</h2>
          <p>
            Signing in does not opt you in. Existing assignments stay with you when you stop
            receiving new work.
          </p>
        </div>
        {availability.isPending ? (
          <p role="status">Checking availability…</p>
        ) : availability.isError ? (
          <p role="alert">{staffError(availability.error)}</p>
        ) : (
          <>
            <strong>
              {availability.data.available
                ? 'Available for new tickets'
                : 'Not available for new tickets'}
            </strong>
            <Button
              tone="secondary"
              disabled={command.blocked}
              onClick={() =>
                command.run(() =>
                  client.prepareAvailability(availability.data, !availability.data.available),
                )
              }
            >
              {availability.data.available
                ? 'Stop receiving new tickets'
                : 'Become available for tickets'}
            </Button>
          </>
        )}
      </section>
      <div className="staff-work-toolbar">
        <div role="group" aria-label="Ticket lists">
          <Button
            tone={view === 'tickets' ? 'primary' : 'quiet'}
            disabled={command.blocked}
            onClick={() => changeView('tickets')}
          >
            {client.access.getSnapshot().role === 'OWNER_ADMIN'
              ? 'All tickets'
              : 'Assigned tickets'}
          </Button>
          <Button
            tone={view === 'queue' ? 'primary' : 'quiet'}
            disabled={command.blocked}
            onClick={() => changeView('queue')}
          >
            Unassigned queue
          </Button>
        </div>
        <Button tone="quiet" onClick={refresh}>
          Refresh desk
        </Button>
      </div>
      {view === 'queue' && !permittedQueue ? (
        <p className="staff-work-notice">
          Become available before reading or claiming the unassigned queue.
        </p>
      ) : page.isPending ? (
        <p role="status">Loading current tickets…</p>
      ) : page.isError ? (
        <p role="alert">{staffError(page.error)}</p>
      ) : page.data ? (
        <>
          <ul className="staff-work-tickets">
            {page.data.items.map((item: QueueItem | StaffTicket) => (
              <li key={item.id}>
                <div>
                  <strong>
                    {item.category} · {item.id.slice(0, 8)}
                  </strong>
                  <p>
                    {item.status.replaceAll('_', ' ')} · {date(item.createdAt)}
                  </p>
                  {'unread' in item ? (
                    <p>
                      {item.unread} conversation unread · {item.noteUnread} notes unread
                    </p>
                  ) : null}
                </div>
                {view === 'queue' ? (
                  <Button
                    tone="secondary"
                    disabled={command.blocked || availability.data?.available !== true}
                    onClick={() => {
                      setClaim(item);
                      setReason('');
                    }}
                  >
                    Review claim
                  </Button>
                ) : (
                  <Button tone="secondary" onClick={() => onOpen(item.id)}>
                    Open ticket
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {!page.data.items.length ? (
            <p>No tickets on this page. Refresh to check for new work.</p>
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
              Previous tickets
            </Button>
            <Button
              tone="secondary"
              disabled={!page.data.nextCursor || command.blocked}
              onClick={() => {
                setPrevious((items) => [...items, cursor]);
                setCursor(page.data.nextCursor);
              }}
            >
              Next tickets
            </Button>
          </div>
        </>
      ) : null}
      {claim ? (
        <section className="staff-work-confirm" aria-labelledby="claim-heading">
          <h2 id="claim-heading">Claim this queued ticket</h2>
          <p>
            Ticket {claim.id}. This requests assignment to your current staff identity. Another
            agent may claim it first.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              command.run(() => client.prepareClaim(claim, reason));
            }}
          >
            <TextField
              label="Claim reason"
              required
              value={reason}
              maxLength={2000}
              disabled={command.blocked}
              onChange={(event) => setReason(event.target.value)}
            />
            <Button type="submit" disabled={command.blocked || !reason.trim()}>
              Confirm ticket claim
            </Button>
            <Button
              tone="quiet"
              disabled={command.blocked}
              onClick={() => {
                setClaim(null);
                setReason('');
              }}
            >
              Cancel claim
            </Button>
          </form>
        </section>
      ) : null}
      <CommandResult command={command} />
    </div>
  );
}
