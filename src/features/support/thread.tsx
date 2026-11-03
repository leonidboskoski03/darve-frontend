import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Link2, RefreshCw } from 'lucide-react';
import { Button } from '@/design-system/button';
import { TextField } from '@/design-system/text-field';
import {
  subscribeSupport,
  SupportError,
  type SupportClient,
  type SupportContext,
  type SupportStreamPhase,
} from '@/services/support/index';
import { statusLabels, ticketLabel, date } from './model';
import { SupportFailure, CommandFeedback } from './common';
import { useSupportCommand } from './use-command';

export function TicketThread({
  client,
  id,
  onList,
  onContext,
}: {
  client: SupportClient;
  id: string;
  onList: () => void;
  onContext: (context: SupportContext) => void;
}) {
  const [epoch, setEpoch] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<(string | null)[]>([]);
  const [body, setBody] = useState('');
  const [contextId, setContextId] = useState('');
  const [kind, setKind] = useState<SupportContext['kind']>('challenge');
  const [reason, setReason] = useState('');
  const [operation, setOperation] = useState<'add' | 'revoke'>('add');
  const [phase, setPhase] = useState<SupportStreamPhase>('connecting');
  const [connection, setConnection] = useState(0);
  const [denied, setDenied] = useState(false);
  const reset = useCallback(() => {
    const key = client.scope.key(['support', 'thread', id]);
    void client.scope.queryClient.cancelQueries({ queryKey: key });
    client.scope.queryClient.removeQueries({ queryKey: key });
    setBody('');
    setContextId('');
    setReason('');
    setOperation('add');
    setCursor(null);
    setPrevious([]);
    setEpoch((value) => value + 1);
  }, [client, id]);
  useEffect(
    () =>
      denied
        ? undefined
        : subscribeSupport({
            session: client.session,
            ticketId: id,
            onReset: reset,
            onPhase: setPhase,
            onDenied: () => {
              reset();
              setDenied(true);
            },
          }),
    [client, id, reset, connection, denied],
  );
  const query = useQuery({
    queryKey: client.scope.key(['support', 'thread', id, epoch, cursor]),
    queryFn: async ({ signal }) => {
      try {
        return await client.thread(id, cursor, signal);
      } catch (error) {
        if (!signal.aborted && error instanceof SupportError) {
          if ([401, 403, 404].includes(error.problem.status ?? 0)) {
            reset();
            setDenied(true);
          } else if (cursor && error.problem.status === 409) reset();
        }
        throw error;
      }
    },
    gcTime: 0,
    enabled: !denied,
  });
  const command = useSupportCommand(
    client,
    () => {
      reset();
      void client.scope.queryClient.invalidateQueries({
        queryKey: client.scope.key(['support', 'tickets']),
      });
    },
    reset,
    () => {
      reset();
      setDenied(true);
    },
  );
  const lost =
    denied ||
    (query.error instanceof SupportError &&
      [401, 403, 404].includes(query.error.problem.status ?? 0));
  const data = query.data;
  const maximum = data?.messages.items.at(-1)?.sequence ?? 0;
  return (
    <div className="support-page">
      <Button tone="quiet" onClick={onList}>
        <ArrowLeft size={17} aria-hidden="true" />
        All conversations
      </Button>
      <header className="support-heading">
        <div>
          <h1>{data && !lost ? ticketLabel(data.ticket) : 'Support conversation'}</h1>
          <p>
            {data && !lost
              ? `Opened ${date(data.ticket.createdAt)}`
              : 'Private to your account and authorized Darve staff.'}
          </p>
        </div>
        <Button tone="secondary" onClick={reset}>
          <RefreshCw size={17} aria-hidden="true" />
          Refresh conversation
        </Button>
      </header>
      {lost ? (
        <div className="support-notice" role="alert">
          <h2>Conversation unavailable</h2>
          <p>
            This conversation is no longer available to your account. Its content and drafts have
            been cleared.
          </p>
          <Button tone="secondary" onClick={onList}>
            Return to support
          </Button>
        </div>
      ) : (
        <>
          <p className="support-live" role="status">
            {
              {
                connecting: 'Connecting to conversation updates…',
                live: 'Connected to conversation updates',
                reconnecting: 'Reconnecting. Refreshing the current conversation.',
                unavailable:
                  'Live updates unavailable. Refresh the conversation to check for replies.',
                closed: 'Conversation updates stopped.',
              }[phase]
            }
            {phase === 'unavailable' ? (
              <Button tone="quiet" onClick={() => setConnection((value) => value + 1)}>
                Reconnect updates
              </Button>
            ) : null}
          </p>
          {query.isPending ? (
            <p role="status" className="support-loading">
              Loading the current conversation…
            </p>
          ) : query.isError ? (
            <SupportFailure error={query.error} retry={reset} />
          ) : data ? (
            <>
              <div className="support-thread-layout">
                <section className="support-conversation" aria-labelledby="messages-heading">
                  <div className="support-section-heading">
                    <h2 id="messages-heading">Conversation</h2>
                    <span className="support-status">{statusLabels[data.ticket.status]}</span>
                  </div>
                  <ol className="support-messages">
                    {data.messages.items.map((message) => (
                      <li
                        key={message.id}
                        className={'support-message support-message--' + message.author}
                      >
                        <div className="support-message__meta">
                          <strong>{message.author === 'streamer' ? 'You' : 'Darve support'}</strong>
                          <time dateTime={message.createdAt}>{date(message.createdAt)}</time>
                        </div>
                        <p className={message.redacted ? 'support-muted' : ''}>
                          {message.redacted ? 'This message is no longer available.' : message.body}
                        </p>
                      </li>
                    ))}
                  </ol>
                  {!data.messages.items.length ? <p>No messages on this page.</p> : null}
                  <div className="support-pagination">
                    <Button
                      tone="secondary"
                      disabled={!previous.length || command.blocked}
                      onClick={() => {
                        setCursor(previous.at(-1) ?? null);
                        setPrevious((items) => items.slice(0, -1));
                      }}
                    >
                      Previous messages
                    </Button>
                    <Button
                      tone="secondary"
                      disabled={!data.messages.nextCursor || command.blocked}
                      onClick={() => {
                        setPrevious((items) => [...items, cursor]);
                        setCursor(data.messages.nextCursor);
                      }}
                    >
                      Next messages
                    </Button>
                  </div>
                  {maximum > data.ticket.readSequence ? (
                    <Button
                      tone="quiet"
                      disabled={command.blocked}
                      onClick={() => command.run(() => client.prepareRead(data.ticket, maximum))}
                    >
                      Mark displayed messages as read
                    </Button>
                  ) : (
                    <p className="support-muted">Displayed messages are marked as read.</p>
                  )}
                  <form
                    className="support-reply"
                    onSubmit={(event) => {
                      event.preventDefault();
                      command.run(() => client.prepareReply(data.ticket, body));
                    }}
                  >
                    <h2>
                      {data.ticket.status === 'resolved'
                        ? 'Reopen this conversation'
                        : 'Reply to support'}
                    </h2>
                    {data.ticket.status === 'resolved' ? (
                      <p>Sending a reply reopens this same ticket.</p>
                    ) : null}
                    <label className="ds-field">
                      <span className="ds-field__label">Your reply (required)</span>
                      <textarea
                        className="ds-input support-textarea"
                        required
                        maxLength={8000}
                        disabled={command.blocked}
                        value={body}
                        onChange={(event) => setBody(event.target.value)}
                      />
                    </label>
                    <p className="support-muted">
                      {body.length.toLocaleString()} / 8,000 characters. Drafts are cleared when
                      current conversation information is reloaded.
                    </p>
                    <Button type="submit" disabled={command.blocked || !body.trim()}>
                      {data.ticket.status === 'resolved'
                        ? 'Send reply and reopen ticket'
                        : 'Send reply'}
                    </Button>
                  </form>
                </section>
                <aside className="support-contexts" aria-labelledby="context-heading">
                  <h2 id="context-heading">
                    <Link2 size={19} aria-hidden="true" />
                    Related context
                  </h2>
                  <p>
                    Share references to your own Darve challenges, collection rounds or broadcasts.
                    The server checks ownership.
                  </p>
                  {data.ticket.contexts.length ? (
                    <ul>
                      {data.ticket.contexts.map((context) => (
                        <li key={context.kind + context.id}>
                          {context.kind === 'broadcast' ? (
                            <span>Broadcast</span>
                          ) : (
                            <Button tone="quiet" onClick={() => onContext(context)}>
                              Open {context.kind === 'round' ? 'collection round' : 'challenge'}
                            </Button>
                          )}
                          <code>{context.id}</code>
                          <Button
                            tone="quiet"
                            disabled={command.blocked}
                            onClick={() => {
                              setKind(context.kind);
                              setContextId(context.id);
                              setOperation('revoke');
                              setReason('');
                            }}
                          >
                            Prepare removal
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="support-muted">No context attached.</p>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      command.run(() =>
                        client.prepareContext(
                          data.ticket,
                          { kind, id: contextId.trim() },
                          operation,
                          reason,
                        ),
                      );
                    }}
                  >
                    <h3>{operation === 'add' ? 'Add owned context' : 'Remove context'}</h3>
                    <div className="ds-field">
                      <label className="ds-field__label" htmlFor="support-context-kind">
                        Context type
                      </label>
                      <select
                        id="support-context-kind"
                        className="ds-input"
                        disabled={command.blocked || operation === 'revoke'}
                        value={kind}
                        onChange={(event) => setKind(event.target.value as SupportContext['kind'])}
                      >
                        <option value="challenge">Challenge</option>
                        <option value="round">Collection round</option>
                        <option value="broadcast">Broadcast</option>
                      </select>
                    </div>
                    <TextField
                      label="Resource ID"
                      required
                      disabled={command.blocked || operation === 'revoke'}
                      value={contextId}
                      onChange={(event) => setContextId(event.target.value)}
                      hint="The complete Darve resource UUID, not a provider URL or access link."
                    />
                    <TextField
                      label="Reason for context change"
                      required
                      maxLength={2000}
                      disabled={command.blocked}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                    <Button
                      type="submit"
                      tone="secondary"
                      disabled={command.blocked || !reason.trim() || !contextId.trim()}
                    >
                      {operation === 'add' ? 'Add context' : 'Confirm context removal'}
                    </Button>
                    {operation === 'revoke' ? (
                      <Button
                        tone="quiet"
                        disabled={command.blocked}
                        onClick={() => {
                          setOperation('add');
                          setContextId('');
                          setReason('');
                        }}
                      >
                        Cancel removal
                      </Button>
                    ) : null}
                  </form>
                </aside>
              </div>
            </>
          ) : null}
          <CommandFeedback command={command} />
        </>
      )}
    </div>
  );
}
