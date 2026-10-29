import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createCollectionClient } from '@/services/collection/index';
import type { CreatorSession, CreatorSnapshot } from '@/services/creator-session/index';
import { Button } from '@/design-system/button';
export function SourcePicker({
  session,
  snapshot,
  value,
  onChange,
}: {
  session: CreatorSession;
  snapshot: CreatorSnapshot;
  value: string;
  onChange: (id: string) => void;
}) {
  const client = useMemo(() => createCollectionClient(session), [session]);
  const [connectionId, setConnectionId] = useState('');
  const accounts = useInfiniteQuery({
    queryKey: snapshot.scope.key(['creator-connections']),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => client.connections(pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });
  const rows = [
    ...new Map(
      (accounts.data?.pages ?? []).flatMap((page) => page.items).map((row) => [row.id, row]),
    ).values(),
  ];
  const selected =
    rows.find((row) => row.id === connectionId) ?? (rows.length === 1 ? rows[0] : undefined);
  const streams = useInfiniteQuery({
    queryKey: snapshot.scope.key(['collection-streams', selected?.id, selected?.version]),
    enabled: !!selected && !accounts.hasNextPage && !accounts.isError,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => client.broadcasts(selected!.id, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });
  const broadcasts = [
    ...new Map(
      (streams.data?.pages ?? []).flatMap((page) => page.items).map((row) => [row.id, row]),
    ).values(),
  ];
  return (
    <fieldset className="report-source">
      <legend>Optional broadcast report</legend>
      <p className="report-muted">
        Select an owned stream to compare its retained totals. Date totals remain separate.
      </p>
      {accounts.isError || streams.isError ? (
        <p role="status">
          Stream selection is unavailable. Your existing report selection is kept.
        </p>
      ) : null}
      {accounts.isPending ? (
        <p role="status">Loading connected accounts…</p>
      ) : (
        <label className="ds-field">
          <span className="ds-field__label">Reporting account</span>
          <select
            className="ds-input"
            value={selected?.id ?? ''}
            onChange={(event) => setConnectionId(event.target.value)}
          >
            <option value="">Choose an account</option>
            {rows.map((row) => (
              <option value={row.id} key={row.id}>
                {row.provider} ·{' '}
                {row.channels
                  .map((channel) => channel.displayName ?? 'Connected channel')
                  .join(', ')}
              </option>
            ))}
          </select>
        </label>
      )}
      {accounts.hasNextPage && (
        <Button
          tone="secondary"
          busy={accounts.isFetchingNextPage}
          onClick={() => {
            void accounts.fetchNextPage();
          }}
        >
          Load more reporting accounts
        </Button>
      )}
      {selected && !accounts.hasNextPage && (
        <>
          <label className="ds-field">
            <span className="ds-field__label">Reporting broadcast</span>
            <select
              className="ds-input"
              value={broadcasts.some((row) => row.id === value) ? value : ''}
              onChange={(event) => onChange(event.target.value)}
              disabled={streams.isFetching || !!streams.hasNextPage || streams.isError}
            >
              <option value="">Choose a broadcast</option>
              {broadcasts.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.status} · {row.providerBroadcastId ?? row.id}
                </option>
              ))}
            </select>
          </label>
          {streams.hasNextPage && (
            <Button
              tone="secondary"
              busy={streams.isFetchingNextPage}
              onClick={() => {
                void streams.fetchNextPage();
              }}
            >
              Load more reporting streams
            </Button>
          )}
        </>
      )}
      {value && (
        <>
          <p className="report-muted">Selected broadcast reference: {value}</p>
          <Button tone="quiet" onClick={() => onChange('')}>
            Clear broadcast selection
          </Button>
        </>
      )}
    </fieldset>
  );
}
