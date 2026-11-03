import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, ArrowRight, MessageSquare } from 'lucide-react';
import { Button } from '@/design-system/button';
import type { SupportClient, SupportTicket } from '@/services/support/index';
import { SupportError } from '@/services/support/index';
import { categoryLabels, statusLabels, ticketLabel, date } from './model';
import { SupportFailure, CommandFeedback } from './common';
import { useSupportCommand } from './use-command';

export function TicketList({
  client,
  onOpen,
}: {
  client: SupportClient;
  onOpen: (id: string) => void;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<(string | null)[]>([]);
  const [creating, setCreating] = useState(false);
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<SupportTicket['category']>('account');
  const [epoch, setEpoch] = useState(0);
  const key = client.scope.key(['support', 'tickets', epoch, cursor]);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => client.tickets(cursor, signal),
    gcTime: 0,
  });
  const refresh = () => {
    void client.scope.queryClient.cancelQueries({
      queryKey: client.scope.key(['support', 'tickets']),
    });
    client.scope.queryClient.removeQueries({ queryKey: client.scope.key(['support', 'tickets']) });
    setCursor(null);
    setPrevious([]);
    setEpoch((value) => value + 1);
  };
  const command = useSupportCommand(
    client,
    (id) => {
      setBody('');
      onOpen(id);
    },
    refresh,
  );
  const denied =
    query.error instanceof SupportError &&
    [401, 403, 404].includes(query.error.problem.status ?? 0);
  return (
    <div className="support-page">
      <header className="support-heading">
        <div>
          <h1>Support</h1>
          <p>A private conversation with Darve about your account or stream.</p>
        </div>
        <Button disabled={creating || command.blocked || denied} onClick={() => setCreating(true)}>
          <Plus size={18} aria-hidden="true" />
          New ticket
        </Button>
      </header>
      {creating && !denied ? (
        <section className="support-compose" aria-labelledby="new-ticket-heading">
          <h2 id="new-ticket-heading">What do you need help with?</h2>
          <p>
            Explain what happened and what you expected. Keep passwords, payment details and access
            links out of your message.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              command.run(() => client.prepareCreate({ category, body, contexts: [] }));
            }}
          >
            <div className="ds-field">
              <label className="ds-field__label" htmlFor="support-category">
                Category
              </label>
              <select
                id="support-category"
                className="ds-input"
                value={category}
                disabled={command.blocked}
                onChange={(event) => setCategory(event.target.value as SupportTicket['category'])}
              >
                {Object.entries(categoryLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <label className="ds-field">
              <span className="ds-field__label">Message (required)</span>
              <textarea
                className="ds-input support-textarea"
                required
                maxLength={8000}
                value={body}
                disabled={command.blocked}
                onChange={(event) => setBody(event.target.value)}
                aria-describedby="support-message-hint"
              />
            </label>
            <p className="support-muted" id="support-message-hint">
              {body.length.toLocaleString()} / 8,000 characters. Server limits may be lower. You can
              add owned challenge or stream context after opening the ticket.
            </p>
            <div className="support-actions">
              <Button type="submit" disabled={command.blocked || !body.trim()}>
                Create ticket
              </Button>
              <Button
                tone="quiet"
                disabled={command.blocked}
                onClick={() => {
                  setCreating(false);
                  setBody('');
                }}
              >
                Cancel ticket
              </Button>
            </div>
          </form>
          <CommandFeedback command={command} />
        </section>
      ) : null}
      <section aria-labelledby="ticket-list-heading">
        <div className="support-section-heading">
          <h2 id="ticket-list-heading">Your conversations</h2>
          <Button tone="quiet" onClick={refresh}>
            Refresh tickets
          </Button>
        </div>
        {query.isPending ? (
          <p role="status" className="support-loading">
            Loading your conversations…
          </p>
        ) : query.isError ? (
          <SupportFailure error={query.error} retry={refresh} />
        ) : (
          <>
            {query.data.items.length ? (
              <ul className="support-ticket-list">
                {query.data.items.map((ticket) => (
                  <li key={ticket.id}>
                    <button className="support-ticket" onClick={() => onOpen(ticket.id)}>
                      <span className="support-ticket__icon">
                        <MessageSquare size={20} aria-hidden="true" />
                      </span>
                      <span className="support-ticket__summary">
                        <strong>{ticketLabel(ticket)}</strong>
                        <span>Updated {date(ticket.updatedAt)}</span>
                      </span>
                      <span className="support-ticket__status">
                        {statusLabels[ticket.status]}
                        {ticket.unread ? <strong>{ticket.unread} unread</strong> : null}
                      </span>
                      <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="support-empty">
                <MessageSquare size={28} aria-hidden="true" />
                <h3>No conversations on this page</h3>
                <p>
                  Open a ticket to ask for help. Your conversation will stay here when you return.
                </p>
              </div>
            )}
            <div className="support-pagination">
              <Button
                tone="secondary"
                disabled={!previous.length}
                onClick={() => {
                  setCursor(previous.at(-1) ?? null);
                  setPrevious((items) => items.slice(0, -1));
                }}
              >
                Previous tickets
              </Button>
              <Button
                tone="secondary"
                disabled={!query.data.nextCursor}
                onClick={() => {
                  setPrevious((items) => [...items, cursor]);
                  setCursor(query.data.nextCursor);
                }}
              >
                Next tickets
              </Button>
            </div>
          </>
        )}
      </section>
      <p className="support-muted">
        Support replies appear in your conversation. Opening a ticket does not guarantee an
        immediate response.
      </p>
    </div>
  );
}
