import { useState } from 'react';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { ArrowRight, Bot, Check, RefreshCw } from 'lucide-react';
import { Button } from '@/design-system/button';
import { Dialog } from '@/design-system/dialog';
import { ProviderMark } from '@/design-system/provider-mark';
import { LoadingState } from '@/design-system/loading-state';
import { ContentState } from '@/design-system/content-state';
import { StatusBadge } from '@/design-system/status-badge';
import {
  type CreatorAccessClient,
  type Connection,
  type Provider,
} from '@/services/creator-access/index';
import type { CreatorSnapshot } from '@/services/creator-session/index';
import { AccessError } from './error-message';
import { providers } from './provider-options';

type Action = {
  connection: Connection;
  kind: 'identity' | 'streaming' | 'bot_destination' | 'unlink';
};
const purposeCopy = {
  identity: {
    title: 'Reconnect your account',
    description:
      'Confirm the identity of this provider account. This does not request posting or pin-replacement permission.',
  },
  streaming: {
    title: 'Allow chat reading',
    description:
      'Allow Darve to read chat for this connected account. This does not authorize DarveBot to post or replace a pinned message.',
  },
  bot_destination: {
    title: 'Allow DarveBot notices',
    description:
      'Allow DarveBot to post collection notices to this Twitch channel. The separate DarveBot account must also be configured. This does not allow replacing a pinned message; that choice is made separately for each collection.',
  },
  unlink: {
    title: 'Disconnect this account?',
    description:
      'This ends the provider connection and may sign you out. Related content can become unavailable. This action does not confirm a refund or transfer funding.',
  },
};
const reasonLabel = (value: Connection['capabilities']['chatRead']) =>
  value.available
    ? 'Available'
    : ((
        {
          PROVIDER_UNCONFIGURED: 'Provider not configured',
          PERMISSION_REQUIRED: 'Permission needed',
          REAUTHORIZATION_REQUIRED: 'Reconnect needed',
          BOT_UNCONFIGURED: 'DarveBot not configured',
          BOT_DESTINATION_DENIED: 'Channel permission needed',
          COLLECTOR_NOT_STARTED: 'Not checked until collection starts',
          GRANT_MISSING: 'Permission missing',
          NOT_IMPLEMENTED: 'Unavailable',
          OFFLINE: 'Channel is offline',
        } as Partial<Record<NonNullable<typeof value.reasonCode>, string>>
      )[value.reasonCode] ?? 'Currently unavailable');

function ActionConfirmation({
  action,
  changed,
  pending,
  error,
  onConfirm,
  onDismiss,
}: {
  action: Action;
  changed: boolean;
  pending: boolean;
  error: unknown;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const [botConsent, setBotConsent] = useState(false);
  const copy = purposeCopy[action.kind];
  return (
    <Dialog open title={copy.title} description={copy.description} onDismiss={onDismiss}>
      <p className="creator-account-name">
        {action.connection.channels
          .map((channel) => channel.displayName ?? 'Connected channel')
          .join(', ') || 'Connected account'}
      </p>
      {action.kind === 'bot_destination' ? (
        <label className="creator-checkbox">
          <input
            type="checkbox"
            checked={botConsent}
            disabled={pending}
            onChange={(event) => setBotConsent(event.currentTarget.checked)}
          />
          <span>Allow DarveBot notices on this channel.</span>
        </label>
      ) : null}
      {changed ? (
        <p role="alert">
          This connection changed. Close this dialog and review the current account information
          before confirming again.
        </p>
      ) : null}
      <AccessError error={error} />
      <div className="creator-dialog-actions">
        <Button tone="secondary" disabled={pending} onClick={onDismiss}>
          Cancel
        </Button>
        <Button
          tone={action.kind === 'unlink' ? 'danger' : 'primary'}
          busy={pending}
          disabled={changed || (action.kind === 'bot_destination' && !botConsent)}
          onClick={onConfirm}
        >
          {action.kind === 'unlink' ? 'Disconnect account' : 'Continue to provider'}
        </Button>
      </div>
    </Dialog>
  );
}

export function Connections({
  client,
  snapshot,
}: {
  client: CreatorAccessClient;
  snapshot: CreatorSnapshot;
}) {
  const query = useInfiniteQuery({
    queryKey: snapshot.scope.key(['creator-connections']),
    initialPageParam: null,
    queryFn: ({ pageParam, signal }: { pageParam: string | null; signal: AbortSignal }) =>
      client.connections(pageParam, signal),
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });
  const [action, setAction] = useState<Action | null>(null);
  const authorization = useMutation({
    mutationFn: ({
      provider,
      connection,
      purpose,
    }: {
      provider: Provider;
      connection?: Connection;
      purpose?: Exclude<Action['kind'], 'unlink'>;
    }) =>
      client.authorize(
        provider,
        connection
          ? {
              intent: 'reauthorize',
              connectionId: connection.id,
              authorizationPurpose: purpose ?? 'identity',
              returnPath: '/integrations',
            }
          : { intent: 'link', connectionId: null, returnPath: '/integrations' },
      ),
    retry: false,
  });
  const unlink = useMutation({
    mutationFn: (connection: Connection) => client.unlink(connection),
    retry: false,
    onError: () => {
      void query.refetch();
    },
  });
  const pending = authorization.isPending || authorization.isSuccess || unlink.isPending;
  const rows = new Map<string, Connection>();
  for (const page of query.data?.pages ?? [])
    for (const row of page.items)
      if ((rows.get(row.id)?.version ?? 0) <= row.version) rows.set(row.id, row);
  const connections = [...rows.values()];
  const changed =
    action !== null && rows.get(action.connection.id)?.version !== action.connection.version;
  const selectAction = (next: Action) => {
    authorization.reset();
    unlink.reset();
    setAction(next);
  };
  return (
    <section className="creator-connections" aria-labelledby="connections-title">
      <div className="creator-connections__header">
        <div>
          <p className="creator-step">03 · Connections</p>
          <h1 id="connections-title">Your streaming accounts</h1>
          <p className="creator-description">
            Manage account identity and permissions separately. Availability below comes from the
            server.
          </p>
        </div>
        <Button
          tone="secondary"
          busy={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Refresh accounts
        </Button>
      </div>
      {query.isPending ? (
        <LoadingState label="Loading provider connections" />
      ) : query.isError ? (
        <ContentState kind="error" title="Account connections could not be loaded">
          <AccessError error={query.error} />
        </ContentState>
      ) : (
        <>
          <div className="creator-connection-grid">
            {providers.map((provider) => {
              const accounts = connections.filter(
                (connection) => connection.provider === provider.id,
              );
              return (
                <section
                  className="creator-card creator-provider-card"
                  aria-labelledby={`provider-${provider.id}`}
                  key={provider.id}
                >
                  <header>
                    <ProviderMark provider={provider.id} size={26} />
                    <h2 id={`provider-${provider.id}`}>{provider.label}</h2>
                  </header>
                  {accounts.length === 0 ? (
                    <>
                      <p className="creator-description">
                        {query.hasNextPage
                          ? 'Load more accounts to check this provider.'
                          : 'No account is connected.'}
                      </p>
                      <Button
                        tone="secondary"
                        disabled={pending || query.hasNextPage}
                        onClick={() => authorization.mutate({ provider: provider.id })}
                      >
                        Connect {provider.label}
                        <ArrowRight size={16} aria-hidden="true" />
                      </Button>
                    </>
                  ) : (
                    accounts.map((connection) => (
                      <div className="creator-connected-account" key={connection.id}>
                        <p className="creator-account-name">
                          {connection.channels
                            .map((channel) => channel.displayName ?? 'Connected channel')
                            .join(', ') || 'Connected account'}
                        </p>
                        <StatusBadge
                          tone={connection.grantState === 'usable' ? 'success' : 'warning'}
                        >
                          {connection.grantState === 'usable'
                            ? 'Account connected'
                            : connection.grantState === 'unknown'
                              ? 'Account status unknown'
                              : 'Account needs attention'}
                        </StatusBadge>
                        <dl className="creator-capabilities">
                          <dt>Chat reading</dt>
                          <dd>{reasonLabel(connection.capabilities.chatRead)}</dd>
                          <dt>DarveBot posting</dt>
                          <dd>{reasonLabel(connection.capabilities.chatWrite)}</dd>
                          <dt>Live context</dt>
                          <dd>{reasonLabel(connection.capabilities.liveContext)}</dd>
                        </dl>
                        <div className="creator-account-actions">
                          <Button
                            tone="secondary"
                            disabled={pending}
                            onClick={() => selectAction({ connection, kind: 'identity' })}
                          >
                            Reconnect account
                          </Button>
                          <Button
                            tone="secondary"
                            disabled={pending}
                            onClick={() => selectAction({ connection, kind: 'streaming' })}
                          >
                            Allow chat reading
                          </Button>
                          {provider.id === 'twitch' ? (
                            <Button
                              tone="secondary"
                              disabled={pending}
                              onClick={() => selectAction({ connection, kind: 'bot_destination' })}
                            >
                              <Bot size={16} aria-hidden="true" />
                              Allow DarveBot notices
                            </Button>
                          ) : null}
                          <Button
                            tone="quiet"
                            disabled={pending}
                            onClick={() => selectAction({ connection, kind: 'unlink' })}
                          >
                            Disconnect
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </section>
              );
            })}
          </div>
          {query.hasNextPage ? (
            <Button
              tone="secondary"
              busy={query.isFetchingNextPage}
              onClick={() => {
                void query.fetchNextPage();
              }}
            >
              Load more accounts
            </Button>
          ) : null}
          <p className="creator-note">
            <Check size={16} aria-hidden="true" />A connected account is not proof of live chat,
            posting or payment readiness. Pin replacement is a separate choice when starting a
            collection.
          </p>
        </>
      )}
      {!action ? (
        <AccessError error={authorization.error} />
      ) : (
        <ActionConfirmation
          key={`${action.connection.id}:${action.connection.version}:${action.kind}`}
          action={action}
          changed={changed}
          pending={pending}
          error={action.kind === 'unlink' ? unlink.error : authorization.error}
          onDismiss={() => {
            if (!pending) setAction(null);
          }}
          onConfirm={() => {
            if (changed || pending) return;
            if (action.kind === 'unlink') unlink.mutate(action.connection);
            else
              authorization.mutate({
                provider: action.connection.provider,
                connection: action.connection,
                purpose: action.kind,
              });
          }}
        />
      )}
    </section>
  );
}
