import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ProviderMark } from '@/design-system/provider-mark';
import { Button } from '@/design-system/button';
import { LoadingState } from '@/design-system/loading-state';
import type { CollectionClient } from '@/services/collection/index';
import type { Connection } from '@/services/creator-access/index';
import type { CreatorSnapshot } from '@/services/creator-session/index';
import { CollectionProblem } from './error';
import { StartSettings } from './start-settings';

const providers = [
  { id: 'twitch', name: 'Twitch' },
  { id: 'youtube', name: 'YouTube' },
  { id: 'kick', name: 'Kick' },
] as const;
export function CollectionSetup({
  client,
  snapshot,
  onStarted,
}: {
  client: CollectionClient;
  snapshot: CreatorSnapshot;
  onStarted: (roundId: string) => void;
}) {
  const [provider, setProvider] = useState<Connection['provider']>('twitch');
  const [connectionId, setConnectionId] = useState('');
  const [locked, setLocked] = useState(false);
  const query = useInfiniteQuery({
    queryKey: snapshot.scope.key(['creator-connections']),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => client.connections(pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });
  const rows = new Map<string, Connection>();
  for (const page of query.data?.pages ?? [])
    for (const row of page.items)
      if ((rows.get(row.id)?.version ?? 0) <= row.version) rows.set(row.id, row);
  const accounts = [...rows.values()].filter((row) => row.provider === provider);
  const selected =
    accounts.find((row) => row.id === connectionId) ??
    (accounts.length === 1 ? accounts[0] : undefined);
  return (
    <>
      <div className="collection-page-heading">
        <span className="collection-eyebrow">Your stream · Your choice</span>
        <h1>Start collection</h1>
        <p>
          Give viewers a moment to share their next challenge. Collect ideas with{' '}
          <strong>#darve</strong>, then review them before choosing.
        </p>
      </div>
      <div className="collection-setup-grid">
        <div>
          <section className="collection-panel" aria-labelledby="platform-title">
            <span className="collection-eyebrow">01 · Source</span>
            <h2 id="platform-title">Where are you streaming?</h2>
            <fieldset className="collection-fieldset" disabled={locked}>
              <legend className="sr-only">Streaming platform</legend>
              <div className="collection-platforms">
                {providers.map((item) => (
                  <label key={item.id} className="collection-platform">
                    <input
                      type="radio"
                      name="provider"
                      value={item.id}
                      checked={provider === item.id}
                      onChange={() => {
                        setProvider(item.id);
                        setConnectionId('');
                      }}
                    />
                    <ProviderMark provider={item.id} />
                    <span>{item.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {query.isPending ? (
              <LoadingState label="Loading your connected accounts" />
            ) : query.isError ? (
              <>
                <CollectionProblem error={query.error} />
                <Button
                  tone="secondary"
                  onClick={() => {
                    void query.refetch();
                  }}
                >
                  Refresh accounts
                </Button>
              </>
            ) : (
              <>
                {accounts.length === 0 ? (
                  <p className="collection-muted">
                    {query.hasNextPage
                      ? 'Load the remaining accounts before choosing a source.'
                      : 'No account is connected on this platform.'}{' '}
                    <a href="/integrations">Manage connections</a>
                  </p>
                ) : (
                  <label className="ds-field">
                    <span className="ds-field__label">Connected account</span>
                    <select
                      className="ds-input"
                      value={selected?.id ?? ''}
                      disabled={locked}
                      onChange={(event) => setConnectionId(event.target.value)}
                    >
                      <option value="" disabled>
                        Choose an account
                      </option>
                      {accounts.map((row) => (
                        <option value={row.id} key={row.id}>
                          {row.channels
                            .map((channel) => channel.displayName ?? 'Connected channel')
                            .join(', ') || 'Connected account'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {query.hasNextPage ? (
                  <Button
                    tone="secondary"
                    busy={query.isFetchingNextPage}
                    disabled={locked}
                    onClick={() => {
                      void query.fetchNextPage();
                    }}
                  >
                    Load more accounts
                  </Button>
                ) : null}
              </>
            )}
          </section>
          {selected && !query.hasNextPage && !query.isError ? (
            <StartSettings
              key={`${selected.id}:${selected.version}`}
              client={client}
              snapshot={snapshot}
              connection={selected}
              onStarted={onStarted}
              onLocked={setLocked}
            />
          ) : null}
        </div>
        <aside className="collection-help">
          <p className="collection-eyebrow">How it works</p>
          <ol>
            <li>
              <strong>Pick your live stream</strong>
              <span>One platform per collection, with its own permissions.</span>
            </li>
            <li>
              <strong>Invite viewer ideas</strong>
              <span>Viewers send #darve followed by their challenge.</span>
            </li>
            <li>
              <strong>Review after collection</strong>
              <span>The server keeps the round and its deadline if you disconnect.</span>
            </li>
          </ol>
          <p>
            To resume an existing collection, open its original tab or saved collection link.
            Previous rounds and accepted challenges are kept.
          </p>
          <a href="/terms">Review account terms</a>
        </aside>
      </div>
    </>
  );
}
